"""Node-level FSRS queue and formal review session lifecycle."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.misc import Config, StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewLog
from memory_anki.infrastructure.db._tables.reviews import ReviewRatingOperation
from memory_anki.modules.reviews.application.node_memory_service import (
    RATING_LABELS,
    due_node_uids_for_entry,
    get_palace_memory_projection,
)

ACTIVE_REVIEW_STATUSES = ("active", "paused")


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


def _palace_payload(palace: Palace) -> dict[str, Any]:
    return {
        "id": palace.id,
        "title": palace.manual_title or palace.title or "未命名宫殿",
        "description": palace.description or "",
        "archived": bool(palace.archived),
        "mastered": False,
        "editor_doc": palace.editor_doc,
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
        "palace": _palace_payload(palace),
    }


def get_fsrs_queue_payload(session: Session, chapter_id: int | None = None) -> dict[str, Any]:
    now = datetime.now(UTC)
    tomorrow = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=UTC)
    due, later = [], []
    for palace in _palaces(session, chapter_id):
        projection = get_palace_memory_projection(session, palace.id)
        nodes = projection["nodes"]
        due_nodes = [item for item in nodes if item.get("due")]
        later_nodes = [
            item
            for item in nodes
            if not item.get("due") and (at := _dt(item.get("due_at"))) and now < at < tomorrow
        ]
        if due_nodes:
            due.append(_queue_item(session, palace, due_nodes, now, projection))
        elif later_nodes:
            later.append(_queue_item(session, palace, later_nodes, now, projection))
    due.sort(key=lambda item: (item["next_due_at"] or "", item["palace_id"]))
    later.sort(key=lambda item: (item["next_due_at"] or "", item["palace_id"]))
    overdue_count = sum(item["overdue_node_count"] for item in due)
    if chapter_id is None:
        config = session.query(Config).filter_by(key="daily_max_reviews").first()
        try:
            daily_limit = int(config.value) if config and config.value else 0
        except (TypeError, ValueError):
            daily_limit = 0
        if daily_limit > 0:
            due = due[:daily_limit]
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
    from memory_anki.modules.reviews.application.review_metrics_service import get_weekly_stats

    return {
        "due_count": sum(item["due_node_count"] for item in due),
        "later_today_count": sum(item["due_node_count"] for item in later),
        "overdue_count": overdue_count,
        "smoothed_count": 0,
        "stats": get_weekly_stats(session),
        "chapter": chapter,
        "reviews": due,
        "later_today_reviews": later,
    }


def get_fsrs_load_forecast(session: Session, days: int = 7) -> dict[str, Any]:
    days = max(1, min(int(days), 60))
    now = datetime.now(UTC)
    today = now.date()
    end = today + timedelta(days=days - 1)
    by_date = {today + timedelta(days=i): 0 for i in range(days)}
    overdue = 0
    for palace in _palaces(session):
        for item in get_palace_memory_projection(session, palace.id)["nodes"]:
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


def get_formal_review_scope(
    session: Session, study_session_id: str, palace_id: int, *, require_active: bool = True
) -> set[str]:
    row = session.get(StudySession, study_session_id)
    if row is None or row.scene != "review" or row.palace_id != palace_id:
        raise ValueError("formal review session not found")
    if require_active and row.status not in ACTIVE_REVIEW_STATUSES:
        raise ValueError("formal review session is no longer active")
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
    active = (
        session.query(StudySession)
        .filter(
            StudySession.scene == "review",
            StudySession.palace_id == palace_id,
            StudySession.status.in_(ACTIVE_REVIEW_STATUSES),
            StudySession.deleted_at.is_(None),
        )
        .order_by(StudySession.started_at.desc())
        .first()
    )
    if active is not None:
        return active
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
    if row.status not in ACTIVE_REVIEW_STATUSES:
        raise ValueError("formal review session is no longer active")
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


def formal_review_completion_summary(session: Session, row: StudySession) -> dict[str, Any]:
    palace = session.get(Palace, row.palace_id) if row.palace_id else None
    if palace is None:
        raise ValueError("palace not found")
    projection = get_palace_memory_projection(session, palace.id)
    scope = set(_scope(row)) & {item["node_uid"] for item in projection["nodes"]}
    ratings = _effective_ratings(session, row, scope)
    counts = {label: 0 for label in RATING_LABELS.values()}
    for rating in ratings.values():
        counts[RATING_LABELS[rating]] += 1
    return {
        "scope_node_count": len(scope),
        "rated_node_count": len(ratings),
        "unrated_due_node_count": len(scope - set(ratings)),
        "rating_counts": counts,
        "mastery_progress": projection["mastery_progress"],
        "mastery_percent": projection["mastery_percent"],
        "memory_health": projection["memory_health"],
        "memory_health_percent": projection["memory_health_percent"],
        "remaining_due_node_count": projection["due_node_count"],
        "next_review_at": projection["next_review_at"],
        "ratings": ratings,
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
    if row.status not in ACTIVE_REVIEW_STATUSES:
        raise ValueError("formal review session is no longer active")
    palace = session.get(Palace, row.palace_id) if row.palace_id else None
    if palace is None:
        raise ValueError("palace not found")
    summary = formal_review_completion_summary(session, row)
    ratings = summary.pop("ratings")
    score = round(sum(ratings.values()) / len(ratings)) if ratings else 0
    ended_at = utc_now_naive()
    log = ReviewLog(
        palace_id=palace.id,
        review_date=ended_at.date(),
        score=score,
        review_mode="fsrs",
        duration_seconds=max(0, int(duration_seconds)),
        note=note.strip()[:2000],
    )
    session.add(log)
    session.flush()
    next_queue = get_fsrs_queue_payload(session, chapter_id)
    next_id = next_queue["reviews"][0]["palace_id"] if next_queue["reviews"] else None
    receipt = {
        "ok": True,
        "completion_mode": completion_mode,
        "score": score,
        "next_id": next_id,
        "review_log_id": log.id,
        "palace_id": palace.id,
        "chapter_id": chapter_id,
        "duration_seconds": max(0, int(duration_seconds)),
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
