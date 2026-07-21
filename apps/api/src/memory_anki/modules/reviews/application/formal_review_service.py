"""Node-level FSRS queue and formal review session lifecycle."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.misc import Config, StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewLog
from memory_anki.infrastructure.db._tables.reviews import ReviewRatingOperation
from memory_anki.modules.reviews.application.node_memory_service import (
    RATING_LABELS,
    VALID_RATINGS,
    due_node_uids_for_entry,
    finalize_formal_review_schedules,
    get_palace_due_rollup,
    get_palace_memory_projection,
    rate_nodes,
)
from memory_anki.modules.reviews.application.review_queue_extras import (
    next_review_scope_from_projection,
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
    return {
        "id": palace.id,
        "title": palace.manual_title or palace.title or "未命名宫殿",
        "description": palace.description or "",
        "archived": bool(palace.archived),
        "mastered": False,
        "editor_doc": palace.editor_doc if include_editor_doc else None,
        "pegs": [],
        "attachments": [
            {"id": item.id, "filename": item.filename, "original_name": item.original_name}
            for item in palace.attachments
        ],
        "chapters": [
            {"id": item.id, "name": item.name, "subject_id": item.subject_id}
            for item in palace.chapters
        ],
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
    next_due = min(times).isoformat() if times else None
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
    today_counts = today_review_counts_by_palace(
        session, [palace.id for palace in palaces]
    )
    due, later = [], []
    for palace in palaces:
        # List/queue paths only need due rollups; skip per-node rating N+1.
        projection = get_palace_due_rollup(session, palace.id, now=now)
        nodes = projection["nodes"]
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
        from memory_anki.modules.reviews.application.review_metrics_service import get_weekly_stats

        stats = get_weekly_stats(session)

    return {
        "due_count": sum(item["due_node_count"] for item in due),
        "later_today_count": sum(item["due_node_count"] for item in later),
        "overdue_count": overdue_count,
        "smoothed_count": 0,
        "stats": stats,
        "chapter": chapter,
        "reviews": due if include_items else [],
        "later_today_reviews": later if include_items else [],
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
    for palace in _palaces(session):
        for item in get_palace_due_rollup(session, palace.id, now=now)["nodes"]:
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


def _abandon_legacy_review_session(row: StudySession, *, reason: str) -> None:
    """Close a review-scene row that is not a valid formal FSRS session.

    Migrated progress rows (e.g. session-progress-*) can stay ``active`` for
    months without ``frozen_due_node_uids``. Resuming them as formal review makes
    ratings save under that id while completion summary reports 0 scope / 0 rated.
    """
    now = utc_now_naive()
    summary = _json(row.summary_json)
    summary["superseded_reason"] = reason
    summary["superseded_at"] = now.isoformat()
    row.status = "abandoned"
    row.ended_at = now
    row.updated_at = now
    row.summary_json = json.dumps(summary, ensure_ascii=False)


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
    if row is None or row.scene != "review" or row.palace_id != palace_id:
        raise ValueError("formal review session not found")
    if require_active:
        ensure_formal_review_session_active(row)
    return set(_scope(row))


def start_or_resume_formal_review(
    session: Session,
    palace_id: int,
    *,
    chapter_id: int | None = None,
    entry_mode: str | None = None,
    branch_uid: str | None = None,
) -> StudySession:
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None or palace.archived:
        raise ValueError("palace not found")
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
            return ensure_formal_review_session_active(active)
        # Legacy progress / migrated review rows: do not resume without a frozen due set.
        _abandon_legacy_review_session(
            active, reason="missing_frozen_due_node_uids"
        )
    projection = get_palace_memory_projection(session, palace_id)
    resolved_mode = entry_mode or projection.get("review_entry_mode") or "palace"
    if resolved_mode == "none":
        raise ValueError("palace has no due FSRS nodes")
    frozen = due_node_uids_for_entry(
        session,
        palace_id,
        entry_mode=resolved_mode if resolved_mode in {"node", "palace"} else "palace",
        branch_uid=branch_uid or projection.get("primary_branch_uid"),
    )
    if not frozen:
        raise ValueError("palace has no due FSRS nodes")
    row = StudySession(
        id=f"review-{uuid.uuid4()}",
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
                "editor_fingerprint": hashlib.sha256(
                    (palace.editor_doc or "").encode("utf-8")
                ).hexdigest(),
            },
            ensure_ascii=False,
        ),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def resolve_formal_review_session(session: Session, identifier: str) -> StudySession:
    row = session.get(StudySession, identifier)
    if row is not None and row.scene == "review" and row.deleted_at is None:
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
    palace = session.get(Palace, row.palace_id) if row.palace_id else None
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    summary = _json(row.summary_json)
    frozen = _scope(row)
    projection = get_palace_memory_projection(session, palace.id)
    entry_mode = summary.get("review_entry_mode") or projection.get("review_entry_mode") or "palace"
    return {
        "id": row.id,
        "session_id": row.id,
        "palace_id": palace.id,
        "algorithm_used": "FSRS",
        "review_type": "fsrs",
        "review_number": 0,
        "frozen_due_node_uids": frozen,
        "due_node_count": len(frozen),
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


def _effective_ratings(session: Session, row: StudySession, scope: set[str]) -> dict[str, int]:
    undone = {
        op.id
        for op in session.query(ReviewRatingOperation)
        .filter(
            ReviewRatingOperation.study_session_id == row.id,
            ReviewRatingOperation.undone_at.is_not(None),
        )
        .all()
    }
    events = (
        session.query(MindMapRecallEvent)
        .filter(MindMapRecallEvent.study_session_id == row.id)
        .order_by(MindMapRecallEvent.occurred_at, MindMapRecallEvent.created_at)
        .all()
    )
    result: dict[str, int] = {}
    for event in events:
        if event.node_uid in scope and not (event.operation_id and event.operation_id in undone):
            result[event.node_uid] = 3 if event.rating == 5 else int(event.rating)
    return result


def _previous_formal_review_snapshot(
    session: Session,
    palace_id: int,
    *,
    exclude_session_id: str | None = None,
) -> dict[str, Any]:
    """Most recent completed formal review for mastery delta / last-review time.

    Excludes the in-progress session so settlement can compare current mastery
    against the last finished formal review receipt.
    """
    query = (
        session.query(StudySession)
        .filter(
            StudySession.palace_id == palace_id,
            StudySession.scene == "review",
            StudySession.status == "completed",
            StudySession.deleted_at.is_(None),
            StudySession.ended_at.is_not(None),
        )
        .order_by(StudySession.ended_at.desc(), StudySession.id.desc())
    )
    if exclude_session_id:
        query = query.filter(StudySession.id != exclude_session_id)
    prev = query.first()
    if prev is None or prev.ended_at is None:
        return {
            "last_review_at": None,
            "previous_mastery_progress": None,
            "previous_mastery_percent": None,
        }
    receipt = _json(prev.summary_json).get("completion_receipt")
    mastery_progress: float | None = None
    mastery_percent: int | None = None
    if isinstance(receipt, dict):
        raw_progress = receipt.get("mastery_progress")
        raw_percent = receipt.get("mastery_percent")
        if isinstance(raw_progress, int | float):
            mastery_progress = round(float(raw_progress), 4)
        if isinstance(raw_percent, int | float):
            mastery_percent = round(float(raw_percent))
        elif mastery_progress is not None:
            mastery_percent = round(mastery_progress * 100)
    return {
        "last_review_at": prev.ended_at.isoformat(),
        "previous_mastery_progress": mastery_progress,
        "previous_mastery_percent": mastery_percent,
    }


def formal_review_completion_summary(session: Session, row: StudySession) -> dict[str, Any]:
    palace = session.get(Palace, row.palace_id) if row.palace_id else None
    if palace is None:
        raise ValueError("palace not found")
    projection = get_palace_memory_projection(session, palace.id)
    projection_uids = {item["node_uid"] for item in projection["nodes"]}
    scope = set(_scope(row)) & projection_uids
    # Legacy sessions (migrated progress, healed receipts) may lack a frozen due
    # set even though MindMapRecallEvent rows were written for this session id.
    # Fall back to "nodes scored in this session ∩ projection" so settlement
    # never reports 0/0 after the user already rated.
    if not scope:
        scope = set(_effective_ratings(session, row, projection_uids))
    ratings = _effective_ratings(session, row, scope) if scope else {}
    counts = {label: 0 for label in RATING_LABELS.values()}
    for rating in ratings.values():
        counts[RATING_LABELS[rating]] += 1
    unrated_uids = sorted(scope - set(ratings))
    next_scope = next_review_scope_from_projection(projection)
    previous = _previous_formal_review_snapshot(
        session, int(palace.id), exclude_session_id=str(row.id)
    )
    return {
        "scope_node_count": len(scope),
        "rated_node_count": len(ratings),
        "unrated_due_node_count": len(unrated_uids),
        "unrated_node_uids": unrated_uids,
        "rating_counts": counts,
        "mastery_progress": projection["mastery_progress"],
        "mastery_percent": projection["mastery_percent"],
        "memory_health": projection["memory_health"],
        "memory_health_percent": projection["memory_health_percent"],
        "remaining_due_node_count": projection["due_node_count"],
        "next_review_at": projection["next_review_at"],
        **previous,
        **next_scope,
        "ratings": ratings,
    }


def rate_unrated_formal_review_nodes(
    session: Session,
    row: StudySession,
    *,
    rating: int,
    operation_id: str,
) -> dict[str, Any]:
    """Rate only nodes still missing a score in this formal session's frozen due scope.

    Settlement one-tap scoring must never overwrite nodes the user already rated.
    The unrated set is always recomputed server-side from session events.
    """
    ensure_formal_review_session_active(row)
    if rating not in VALID_RATINGS:
        raise ValueError("rating must be between 1 and 4")
    batch_id = str(operation_id or "").strip()
    if not batch_id:
        raise ValueError("operation_id is required")
    if row.palace_id is None:
        raise ValueError("palace not found")

    summary = formal_review_completion_summary(session, row)
    unrated_uids = [str(uid) for uid in (summary.get("unrated_node_uids") or []) if uid]
    already_rated_count = int(summary.get("rated_node_count") or 0)
    if not unrated_uids:
        return {
            "affected_node_count": 0,
            "affected_node_uids": [],
            "skipped_rated_node_count": already_rated_count,
            "operation_ids": [],
            "summary": summary,
        }

    affected: list[str] = []
    operation_ids: list[str] = []
    scope = set(_scope(row))
    for index, node_uid in enumerate(unrated_uids):
        # Re-check after each write so concurrent direct ratings are not overwritten.
        current = _effective_ratings(session, row, scope)
        if node_uid in current:
            continue
        # Stable per-node ids keep retries idempotent without clobbering siblings.
        node_operation_id = f"{batch_id}:{index}"[:64]
        rate_nodes(
            session,
            palace_id=int(row.palace_id),
            node_uid=node_uid,
            rating=rating,
            study_session_id=str(row.id),
            operation_id=node_operation_id,
            rating_scope="single",
            conflict_policy="skip_direct",
            source_scene="formal_review",
            recall_round="first",
            rating_source="manual",
        )
        affected.append(node_uid)
        operation_ids.append(node_operation_id)

    refreshed = formal_review_completion_summary(session, row)
    return {
        "affected_node_count": len(affected),
        "affected_node_uids": affected,
        "skipped_rated_node_count": already_rated_count,
        "operation_ids": operation_ids,
        "summary": refreshed,
    }


def complete_formal_review(
    session: Session,
    row: StudySession,
    *,
    duration_seconds: int,
    completion_mode: str,
    note: str,
    chapter_id: int | None,
) -> dict[str, Any]:
    existing = _json(row.summary_json)
    if row.status == "completed" and existing.get("completion_receipt"):
        return dict(existing["completion_receipt"])
    ensure_formal_review_session_active(row)
    palace = session.get(Palace, row.palace_id) if row.palace_id else None
    if palace is None:
        raise ValueError("palace not found")
    summary = formal_review_completion_summary(session, row)
    ratings = summary.pop("ratings")
    score = round(sum(ratings.values()) / len(ratings)) if ratings else 0
    ended_at = utc_now_naive()
    # Scheduling clock starts at completion, not at each mid-session click.
    # 忘记/困难 caps (10/30 min) would otherwise expire during a long session.
    finalize_formal_review_schedules(
        session,
        study_session_id=str(row.id),
        palace_id=int(palace.id),
        finalized_at=ended_at,
    )
    # Receipt due/next fields must reflect post-finalize schedules.
    projection = get_palace_memory_projection(session, palace.id)
    summary["remaining_due_node_count"] = projection["due_node_count"]
    summary["next_review_at"] = projection["next_review_at"]
    summary["mastery_progress"] = projection["mastery_progress"]
    summary["mastery_percent"] = projection["mastery_percent"]
    summary["memory_health"] = projection["memory_health"]
    summary["memory_health_percent"] = projection["memory_health_percent"]
    summary.update(next_review_scope_from_projection(projection))
    # Receipt "上次复习" is this just-finished session; keep previous mastery for delta.
    summary["last_review_at"] = ended_at.isoformat()
    # review_date is the learner's local calendar day (matches today_review_counts).
    # ended_at is UTC-naive; using its .date() near UTC midnight miscounts "今日".
    log = ReviewLog(
        palace_id=palace.id,
        review_date=date.today(),
        score=score,
        review_mode="fsrs",
        duration_seconds=max(0, int(duration_seconds)),
        note=note.strip()[:2000],
    )
    session.add(log)
    session.flush()
    next_id = get_next_due_palace_id(session, chapter_id=chapter_id)
    # Include this just-written log so the receipt matches queue "today" count.
    today_review_count = today_review_counts_by_palace(session, [int(palace.id)]).get(
        int(palace.id), 0
    )
    receipt = {
        "ok": True,
        "completion_mode": completion_mode,
        "score": score,
        "next_id": next_id,
        "review_log_id": log.id,
        "palace_id": palace.id,
        "chapter_id": chapter_id,
        "duration_seconds": max(0, int(duration_seconds)),
        "today_review_count": today_review_count,
        **summary,
    }
    row.status = "completed"
    row.ended_at = ended_at
    row.effective_seconds = receipt["duration_seconds"]
    row.completion_method = completion_mode or "manual_complete"
    row.progress_json = "{}"
    row.summary_json = json.dumps({**existing, "completion_receipt": receipt}, ensure_ascii=False)
    session.flush()
    return receipt


def get_fsrs_completion(session: Session, review_log_id: int) -> dict[str, Any] | None:
    rows = (
        session.query(StudySession)
        .filter(StudySession.scene == "review", StudySession.status == "completed")
        .order_by(StudySession.ended_at.desc())
        .all()
    )
    for row in rows:
        receipt = _json(row.summary_json).get("completion_receipt")
        if isinstance(receipt, dict) and receipt.get("review_log_id") == review_log_id:
            return dict(receipt)
    return None
