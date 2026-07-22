"""Node-level FSRS queue and formal review session lifecycle."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import Config, StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.memory.application.node_due_rollup_batch import (
    project_due_rollups_batch,
)
from memory_anki.modules.memory.application.node_memory_service import (
    due_node_uids_for_entry,
    get_palace_memory_projection,
)
from memory_anki.modules.memory.application.review_queue_extras import (
    today_review_counts_by_palace,
)

# Align with general study-session active set so recovered formal rows stay ratable.
ACTIVE_REVIEW_STATUSES = ("active", "paused", "recovered")
INACTIVE_REVIEW_MESSAGE = "本轮正式复习已结束，请返回复习队列重新开始"


def _json(raw: str | None) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _palaces(session: Session, chapter_id: int | None = None) -> list[Palace]:
    query = session.query(Palace).filter(Palace.archived == False, Palace.deleted_at.is_(None))  # noqa: E712
    if chapter_id is not None:
        from memory_anki.infrastructure.db._tables.knowledge import Chapter

        query = query.filter(Palace.chapters.any(Chapter.id == chapter_id))
    return query.order_by(Palace.id).all()


def _palace_payload(palace: Palace, *, include_editor_doc: bool = True) -> dict[str, Any]:
    # Queue/list paths intentionally omit relationship walks (attachments/chapters)
    # to avoid per-palace lazy loads; detail endpoints load full palace separately.
    return {
        "id": palace.id,
        "title": palace.manual_title or palace.title or "未命名宫殿",
        "description": palace.description or "",
        "archived": bool(palace.archived),
        "mastered": False,
        "editor_doc": palace.editor_doc if include_editor_doc else None,
        "pegs": [],
        "attachments": [],
        "chapters": [],
    }


def _queue_item(
    session: Session,
    palace: Palace,
    nodes: list[dict[str, Any]],
    now: datetime,
    projection: dict[str, Any] | None = None,
    *,
    today_review_count: int = 0,
) -> dict[str, Any]:
    times = [parsed for item in nodes if (parsed := _dt(item.get("due_at"))) is not None]
    next_due = to_api_datetime(min(times)) if times else None
    overdue = sum(1 for item in times if item < now)
    projection = projection or {}
    return {
        "id": palace.id,
        "palace_id": palace.id,
        "session_id": None,
        "algorithm_used": "FSRS",
        "scheduled_date": next_due[:10] if next_due else now.date().isoformat(),
        "due_at": next_due,
        "next_due_at": next_due,
        "completed": False,
        "review_number": 0,
        "review_type": "fsrs",
        "interval_days": None,
        "due_node_count": len(nodes),
        "overdue_node_count": overdue,
        "schedule_count": len(nodes),
        "overdue_schedule_count": overdue,
        "next_due_date": next_due[:10] if next_due else now.date().isoformat(),
        "review_entry_mode": projection.get("review_entry_mode") or "palace",
        "review_entry_label": projection.get("review_entry_label"),
        "primary_branch_uid": projection.get("primary_branch_uid"),
        "primary_branch_title": projection.get("primary_branch_title"),
        "due_branch_count": projection.get("due_branch_count") or 0,
        "review_branch_summaries": list(
            projection.get("review_branch_summaries") or []
        ),
        # Completed formal sessions today (node + full palace each +1).
        "today_review_count": max(0, int(today_review_count)),
        "palace": _palace_payload(palace, include_editor_doc=False),
    }


# Default: earliest next_due first so long-overdue palaces surface first.
# String ISO sort is unsafe when naive/aware formats mix; always parse to datetime.
QUEUE_SORT_MODES = frozenset(
    {"due_asc", "due_desc", "due_nodes_desc", "overdue_desc", "title_asc"}
)
_QUEUE_SORT_FAR_FUTURE = datetime(9999, 1, 1, tzinfo=UTC)
_QUEUE_SORT_FAR_PAST = datetime(1970, 1, 1, tzinfo=UTC)


def _queue_item_due_at(item: dict[str, Any]) -> datetime | None:
    return _dt(item.get("next_due_at") or item.get("due_at"))


def _queue_item_title(item: dict[str, Any]) -> str:
    palace = item.get("palace") or {}
    return str(palace.get("title") or "").casefold()


def sort_queue_items(
    items: list[dict[str, Any]],
    sort_by: str = "due_asc",
) -> list[dict[str, Any]]:
    """Stable multi-key sort for formal FSRS queue rows."""
    mode = sort_by if sort_by in QUEUE_SORT_MODES else "due_asc"
    ordered = list(items)
    if mode == "due_asc":
        ordered.sort(
            key=lambda item: (
                _queue_item_due_at(item) or _QUEUE_SORT_FAR_FUTURE,
                int(item.get("palace_id") or 0),
            )
        )
    elif mode == "due_desc":
        ordered.sort(
            key=lambda item: (
                _queue_item_due_at(item) or _QUEUE_SORT_FAR_PAST,
                -int(item.get("palace_id") or 0),
            ),
            reverse=True,
        )
    elif mode == "due_nodes_desc":
        ordered.sort(
            key=lambda item: (
                -int(item.get("due_node_count") or 0),
                _queue_item_due_at(item) or _QUEUE_SORT_FAR_FUTURE,
                int(item.get("palace_id") or 0),
            )
        )
    elif mode == "overdue_desc":
        ordered.sort(
            key=lambda item: (
                -int(item.get("overdue_node_count") or 0),
                _queue_item_due_at(item) or _QUEUE_SORT_FAR_FUTURE,
                int(item.get("palace_id") or 0),
            )
        )
    else:  # title_asc
        ordered.sort(
            key=lambda item: (
                _queue_item_title(item),
                _queue_item_due_at(item) or _QUEUE_SORT_FAR_FUTURE,
                int(item.get("palace_id") or 0),
            )
        )
    return ordered


def get_fsrs_queue_payload(
    session: Session,
    chapter_id: int | None = None,
    *,
    include_stats: bool = True,
    include_items: bool = True,
    sort_by: str = "due_asc",
) -> dict[str, Any]:
    now = datetime.now(UTC)
    tomorrow = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=UTC)
    palaces = _palaces(session, chapter_id)
    palace_ids = [palace.id for palace in palaces]
    today_counts = today_review_counts_by_palace(session, palace_ids)
    # One states query + one FSRS settings load for the whole queue.
    rollups = project_due_rollups_batch(
        session,
        palaces,
        now=now,
        include_nodes=True,
    )
    due, later = [], []
    for palace in palaces:
        projection = rollups.get(int(palace.id)) or {}
        nodes = list(projection.get("nodes") or [])
        due_nodes = [item for item in nodes if item.get("due")]
        later_nodes = [
            item
            for item in nodes
            if not item.get("due") and (at := _dt(item.get("due_at"))) and now < at < tomorrow
        ]
        today_count = today_counts.get(int(palace.id), 0)
        if due_nodes:
            due.append(
                _queue_item(
                    session,
                    palace,
                    due_nodes,
                    now,
                    projection,
                    today_review_count=today_count,
                )
            )
        elif later_nodes:
            later.append(
                _queue_item(
                    session,
                    palace,
                    later_nodes,
                    now,
                    projection,
                    today_review_count=today_count,
                )
            )
    # Always earliest-due first before daily limit so overdue work is not dropped.
    due = sort_queue_items(due, "due_asc")
    later = sort_queue_items(later, "due_asc")
    overdue_count = sum(item["overdue_node_count"] for item in due)
    if chapter_id is None:
        config = session.query(Config).filter_by(key="daily_max_reviews").first()
        try:
            daily_limit = int(config.value) if config and config.value else 0
        except (TypeError, ValueError):
            daily_limit = 0
        if daily_limit > 0:
            due = due[:daily_limit]
    # Optional display sort after limit (next-due / dashboard still default due_asc).
    if sort_by != "due_asc":
        due = sort_queue_items(due, sort_by)
        later = sort_queue_items(later, sort_by)
    chapter = None
    if chapter_id is not None:
        from memory_anki.infrastructure.db._tables.knowledge import Chapter

        row = session.get(Chapter, chapter_id)
        if row is not None:
            chapter = {
                "id": row.id,
                "name": row.name,
                "subject_id": row.subject_id,
                "subject": (
                    {"id": row.subject.id, "name": row.subject.name}
                    if row.subject is not None
                    else None
                ),
            }
    stats = {}
    if include_stats:
        from memory_anki.modules.memory.application.review_metrics_service import get_weekly_stats

        stats = get_weekly_stats(session)

    reinforcement_waves: list[dict[str, Any]] = []
    if include_items:
        from memory_anki.infrastructure.db._tables.reviews import ReviewWave
        from memory_anki.modules.memory.application.wave_queries import wave_payload

        palace_by_id = {int(palace.id): palace for palace in palaces}
        wave_rows = (
            session.query(ReviewWave)
            .filter(
                ReviewWave.palace_id.in_(palace_ids),
                ReviewWave.wave_type == "same_day_reinforcement",
                ReviewWave.status.in_(["scheduled", "active", "paused"]),
                ReviewWave.available_at.is_not(None),
                ReviewWave.available_at <= utc_now_naive(),
            )
            .order_by(ReviewWave.available_at.asc())
            .all()
            if palace_ids
            else []
        )
        for wave in wave_rows:
            wave_palace = palace_by_id.get(int(wave.palace_id))
            item = wave_payload(wave)
            item["palace_title"] = (
                wave_palace.manual_title or wave_palace.title or "未命名宫殿"
                if wave_palace
                else "未命名宫殿"
            )
            reinforcement_waves.append(item)

    return {
        "due_count": sum(item["due_node_count"] for item in due),
        "later_today_count": sum(item["due_node_count"] for item in later),
        "overdue_count": overdue_count,
        "smoothed_count": 0,
        "stats": stats,
        "chapter": chapter,
        "reviews": due if include_items else [],
        "later_today_reviews": later if include_items else [],
        "reinforcement_waves": reinforcement_waves,
    }


def get_next_due_palace_id(
    session: Session,
    *,
    chapter_id: int | None = None,
) -> int | None:
    """Pick the next due palace without building the full queue payload/stats."""
    payload = get_fsrs_queue_payload(
        session,
        chapter_id,
        include_stats=False,
        include_items=True,
    )
    reviews = payload.get("reviews") or []
    if not reviews:
        return None
    first = reviews[0]
    palace_id = first.get("palace_id") or first.get("id")
    return int(palace_id) if palace_id is not None else None


def get_fsrs_load_forecast(session: Session, days: int = 7) -> dict[str, Any]:
    days = max(1, min(int(days), 60))
    now = datetime.now(UTC)
    today = now.date()
    end = today + timedelta(days=days - 1)
    by_date = {today + timedelta(days=i): 0 for i in range(days)}
    overdue = 0
    palaces = _palaces(session)
    rollups = project_due_rollups_batch(session, palaces, now=now, include_nodes=True)
    for palace in palaces:
        for item in (rollups.get(int(palace.id)) or {}).get("nodes") or []:
            at = _dt(item.get("due_at"))
            if at is None:
                continue
            if at < now:
                overdue += 1
            elif at.date() <= end:
                by_date[at.date()] = by_date.get(at.date(), 0) + 1
    items = [
        {"date": day.isoformat(), "due_count": by_date.get(day, 0), "is_today": day == today}
        for day in sorted(by_date)
    ]
    return {
        "days": days,
        "overdue_count": overdue,
        "total_upcoming": sum(item["due_count"] for item in items),
        "items": items,
    }


def _scope(row: StudySession) -> list[str]:
    value = _json(row.summary_json).get("frozen_due_node_uids")
    return [str(item) for item in value] if isinstance(value, list) else []


def _has_frozen_scope(row: StudySession) -> bool:
    """Real FSRS formal sessions always freeze a non-empty due set at start."""
    return bool(_scope(row))


def expand_formal_review_frozen_scope(session: Session, row: StudySession) -> bool:
    """No-op under palace-wave model.

    Freeze scope is fixed at wave start. Newly due nodes only join after explicit
    user-confirmed merge (see wave_service.merge_new_due_into_wave). Kept as a
    stub so older callers remain import-safe.
    """
    del session, row
    return False


def _abandon_legacy_review_session(row: StudySession, *, reason: str) -> None:
    """Close a review-scene row that is not a valid formal FSRS session.

    Migrated progress rows (e.g. session-progress-*) can stay ``active`` for
    months without ``frozen_due_node_uids``. Resuming them as formal review makes
    ratings save under that id while completion summary reports 0 scope / 0 rated.
    """
    now = utc_now_naive()
    summary = _json(row.summary_json)
    summary["superseded_reason"] = reason
    summary["superseded_at"] = to_api_datetime(now)
    row.status = "abandoned"
    row.ended_at = now
    row.updated_at = now
    row.summary_json = json.dumps(summary, ensure_ascii=False)


def _supersede_duplicate_active_reviews(
    session: Session,
    *,
    palace_id: int,
    keep_id: str,
) -> int:
    """Abandon other active formal sessions for the same palace.

    Racey double-entry can leave twin active rows; only one may own resume/rating.
    """
    duplicates = (
        session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.palace_id == palace_id,
            StudySession.status.in_(ACTIVE_REVIEW_STATUSES),
            StudySession.deleted_at.is_(None),
            StudySession.id != keep_id,
        )
        .all()
    )
    for row in duplicates:
        _abandon_legacy_review_session(row, reason="duplicate_active_session")
    return len(duplicates)


def ensure_formal_review_session_active(row: StudySession) -> StudySession:
    """Keep formal review ratable while the user is still on the session page.

    Recovered rows are healed back to active (same spirit as general study sessions).
    Completed / abandoned sessions stay closed.
    """
    if row.status in ACTIVE_REVIEW_STATUSES:
        if row.status == "recovered":
            row.status = "active"
            row.ended_at = None
            row.updated_at = utc_now_naive()
        return row
    raise ValueError(INACTIVE_REVIEW_MESSAGE)


def get_formal_review_scope(
    session: Session, study_session_id: str, palace_id: int, *, require_active: bool = True
) -> set[str]:
    row = session.get(StudySession, study_session_id)
    if (
        row is None
        or row.scene not in {"review", "reinforcement_review"}
        or row.palace_id != palace_id
    ):
        raise ValueError("formal review session not found")
    if require_active:
        ensure_formal_review_session_active(row)
    return set(_scope(row))


def _normalize_scope_node_uids(raw: list[str] | None) -> list[str] | None:
    if raw is None:
        return None
    ordered: list[str] = []
    seen: set[str] = set()
    for item in raw:
        uid = str(item or "").strip()
        if not uid or uid in seen:
            continue
        seen.add(uid)
        ordered.append(uid)
    return ordered


def start_or_resume_formal_review(
    session: Session,
    palace_id: int,
    *,
    chapter_id: int | None = None,
    entry_mode: str | None = None,
    branch_uid: str | None = None,
    scope_node_uids: list[str] | None = None,
) -> StudySession:
    from memory_anki.modules.memory.application.wave_service import (
        find_active_formal_wave,
        frozen_node_uids,
        start_formal_wave,
    )

    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None or palace.archived:
        raise ValueError("palace not found")
    requested_scope = _normalize_scope_node_uids(scope_node_uids)
    requested_scope_set = set(requested_scope) if requested_scope is not None else None

    active_rows = (
        session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.palace_id == palace_id,
            StudySession.status.in_(ACTIVE_REVIEW_STATUSES),
            StudySession.deleted_at.is_(None),
        )
        .order_by(StudySession.started_at.desc())
        .all()
    )
    for active in active_rows:
        if _has_frozen_scope(active):
            # Explicit freestyle/unit scopes must not resume a mismatched palace session.
            if requested_scope_set is not None and set(_scope(active)) != requested_scope_set:
                continue
            keep = ensure_formal_review_session_active(active)
            # Full-palace starts still collapse duplicate actives; unit scopes do not.
            if requested_scope_set is None:
                superseded = _supersede_duplicate_active_reviews(
                    session, palace_id=palace_id, keep_id=str(keep.id)
                )
            else:
                superseded = 0
            # Attach/resume open formal wave without expanding freeze (palace path only).
            summary = _json(keep.summary_json)
            wave = None
            if requested_scope_set is None:
                wave = find_active_formal_wave(session, palace_id)
                if wave is not None:
                    wave.active_session_id = str(keep.id)
                    if wave.status == "paused":
                        wave.status = "active"
                        wave.paused_at = None
                    wave.updated_at = utc_now_naive()
                    summary["wave_id"] = wave.id
                    keep.summary_json = json.dumps(summary, ensure_ascii=False)
            if superseded or wave is not None:
                session.commit()
                session.refresh(keep)
            return keep
        # Legacy progress / migrated review rows: do not resume without a frozen due set.
        _abandon_legacy_review_session(
            active, reason="missing_frozen_due_node_uids"
        )
    projection = get_palace_memory_projection(session, palace_id)
    resolved_mode = entry_mode or projection.get("review_entry_mode") or "palace"
    if requested_scope is not None:
        # Unit-scoped start (freestyle): force node mode and exact due intersection.
        resolved_mode = "node"
    if resolved_mode == "none":
        raise ValueError("palace has no due FSRS nodes")
    frozen = due_node_uids_for_entry(
        session,
        palace_id,
        entry_mode=resolved_mode if resolved_mode in {"node", "palace"} else "palace",
        branch_uid=branch_uid or projection.get("primary_branch_uid"),
        scope_node_uids=requested_scope,
    )
    if not frozen:
        raise ValueError("palace has no due FSRS nodes")
    session_id = f"review-{uuid.uuid4()}"
    wave_id: str | None = None
    if requested_scope is None:
        # Standard palace formal entry: freeze into the formal wave.
        wave = start_formal_wave(
            session,
            palace_id,
            node_uids=frozen,
            session_id=session_id,
        )
        frozen = frozen_node_uids(session, wave.id) or frozen
        wave_id = wave.id
    else:
        # Freestyle unit batch: session-only freeze so an active full-palace wave
        # is never reused as this unit's scope.
        existing_wave = find_active_formal_wave(session, palace_id)
        if existing_wave is not None:
            existing_uids = set(frozen_node_uids(session, existing_wave.id) or [])
            if existing_uids == set(frozen):
                existing_wave.active_session_id = session_id
                existing_wave.updated_at = utc_now_naive()
                if existing_wave.status == "paused":
                    existing_wave.status = "active"
                    existing_wave.paused_at = None
                wave_id = existing_wave.id
        # else: leave wave_id None; FSRS writes still apply via rate_nodes.
    row = StudySession(
        id=session_id,
        status="active",
        scene="review",
        target_type="palace",
        target_id=palace_id,
        palace_id=palace_id,
        title=palace.manual_title or palace.title or "未命名宫殿",
        started_at=utc_now_naive(),
        progress_json="{}",
        events_json="[]",
        summary_json=json.dumps(
            {
                "frozen_due_node_uids": frozen,
                "wave_id": wave_id,
                "chapter_id": chapter_id,
                "review_entry_mode": resolved_mode,
                "primary_branch_uid": (
                    branch_uid or projection.get("primary_branch_uid")
                    if resolved_mode == "node"
                    else None
                ),
                "primary_branch_title": (
                    projection.get("primary_branch_title") if resolved_mode == "node" else None
                ),
                "review_entry_label": projection.get("review_entry_label"),
                "explicit_scope": bool(requested_scope is not None),
                "editor_fingerprint": hashlib.sha256(
                    (palace.editor_doc or "").encode("utf-8")
                ).hexdigest(),
            },
            ensure_ascii=False,
        ),
    )
    session.add(row)
    session.flush()
    # Unit-scoped freestyle sessions must not supersede a full-palace formal session.
    if requested_scope is None:
        _supersede_duplicate_active_reviews(
            session, palace_id=palace_id, keep_id=str(row.id)
        )
    session.commit()
    session.refresh(row)
    return row


def resolve_formal_review_session(session: Session, identifier: str) -> StudySession:
    row = session.get(StudySession, identifier)
    if (
        row is not None
        and row.scene in {"review", "reinforcement_review"}
        and row.deleted_at is None
    ):
        if _has_frozen_scope(row):
            return row
        # Completed legacy rows keep their id so historical receipts/summaries still load
        # (summary falls back to session events when frozen scope is empty).
        if row.status == "completed":
            return row
        # Active/paused/recovered/abandoned progress rows without a frozen due set must
        # not keep serving as formal review (settlement would show 0 rated).
        if row.palace_id is not None:
            return start_or_resume_formal_review(session, int(row.palace_id))
        return row
    # Digit ids are palace ids (legacy schedule ids are no longer accepted).
    if identifier.isdigit():
        return start_or_resume_formal_review(session, int(identifier))
    raise ValueError("formal review session not found")


def formal_review_session_payload(session: Session, row: StudySession) -> dict[str, Any]:
    from memory_anki.modules.memory.application.wave_service import (
        resume_formal_wave,
        wave_progress,
    )

    palace = session.get(Palace, row.palace_id) if row.palace_id else None
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    summary = _json(row.summary_json)
    frozen = _scope(row)
    projection = get_palace_memory_projection(session, palace.id)
    entry_mode = summary.get("review_entry_mode") or projection.get("review_entry_mode") or "palace"
    wave_id = summary.get("wave_id")
    mergeable: list[str] = []
    progress: dict[str, Any] = {}
    if wave_id and row.status in ACTIVE_REVIEW_STATUSES:
        try:
            resumed = resume_formal_wave(session, str(wave_id), session_id=str(row.id))
            mergeable = list(resumed.get("mergeable_node_uids") or [])
            progress = wave_progress(session, str(wave_id))
            if mergeable or progress:
                session.commit()
        except ValueError:
            pass
    return {
        "id": row.id,
        "session_id": row.id,
        "palace_id": palace.id,
        "algorithm_used": "FSRS",
        "review_type": "fsrs",
        "review_number": 0,
        "frozen_due_node_uids": frozen,
        "due_node_count": len(frozen),
        "wave_id": wave_id,
        "wave_progress": progress,
        "mergeable_node_uids": mergeable,
        "mergeable_count": len(mergeable),
        "chapter_id": summary.get("chapter_id"),
        "review_entry_mode": entry_mode,
        "review_entry_label": summary.get("review_entry_label")
        or projection.get("review_entry_label"),
        "primary_branch_uid": summary.get("primary_branch_uid"),
        "primary_branch_title": summary.get("primary_branch_title"),
        "memory_summary": projection,
        "palace": _palace_payload(palace),
    }


def get_formal_review_progress(row: StudySession) -> dict[str, Any]:
    return {"progress": _json(row.progress_json)}


def save_formal_review_progress(
    session: Session, row: StudySession, payload: dict[str, Any]
) -> dict[str, Any]:
    ensure_formal_review_session_active(row)
    row.progress_json = json.dumps(payload, ensure_ascii=False)
    row.updated_at = utc_now_naive()
    session.commit()
    return {"ok": True, "progress": payload}


def clear_formal_review_progress(session: Session, row: StudySession) -> dict[str, Any]:
    row.progress_json = "{}"
    row.updated_at = utc_now_naive()
    session.commit()
    return {"ok": True}


# Settlement (summary, bulk rate, complete, receipt) lives in formal_review_settlement.
# Re-export for public/router imports that still target this module.
from memory_anki.modules.memory.application.formal_review_settlement import (  # noqa: E402
    complete_formal_review,
    formal_review_completion_summary,
    get_fsrs_completion,
    rate_out_of_scope_due_formal_review_nodes,
    rate_unrated_formal_review_nodes,
)

__all__ = [
    "ACTIVE_REVIEW_STATUSES",
    "INACTIVE_REVIEW_MESSAGE",
    "clear_formal_review_progress",
    "complete_formal_review",
    "ensure_formal_review_session_active",
    "expand_formal_review_frozen_scope",
    "formal_review_completion_summary",
    "formal_review_session_payload",
    "get_formal_review_progress",
    "get_formal_review_scope",
    "get_fsrs_completion",
    "get_fsrs_load_forecast",
    "get_fsrs_queue_payload",
    "get_next_due_palace_id",
    "rate_out_of_scope_due_formal_review_nodes",
    "rate_unrated_formal_review_nodes",
    "resolve_formal_review_session",
    "save_formal_review_progress",
    "sort_queue_items",
    "start_or_resume_formal_review",
]
