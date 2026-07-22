"""Formal review settlement: completion summary, bulk rating, and receipt."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewLog
from memory_anki.infrastructure.db._tables.reviews import ReviewRatingOperation
from memory_anki.modules.reviews.application.formal_review_service import (
    _json,
    _scope,
    ensure_formal_review_session_active,
    get_next_due_palace_id,
)
from memory_anki.modules.reviews.application.node_memory_batch_rating import (
    rate_nodes_batch_single,
)
from memory_anki.modules.reviews.application.node_memory_service import (
    RATING_LABELS,
    VALID_RATINGS,
    finalize_formal_review_schedules,
    get_palace_memory_projection,
    list_due_nodes,
)
from memory_anki.modules.reviews.application.review_queue_extras import (
    next_review_scope_from_projection,
    today_review_counts_by_palace,
)


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
        "last_review_at": to_api_datetime(prev.ended_at),
        "previous_mastery_progress": mastery_progress,
        "previous_mastery_percent": mastery_percent,
    }


def formal_review_completion_summary(session: Session, row: StudySession) -> dict[str, Any]:
    palace = session.get(Palace, row.palace_id) if row.palace_id else None
    if palace is None:
        raise ValueError("palace not found")
    # Freeze scope is fixed at wave start; no auto-expand on settlement.
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
    due_uids = {
        str(item["node_uid"])
        for item in projection["nodes"]
        if item.get("due") and item.get("node_uid")
    }
    # Due cards still outside frozen set after expand (edge case, not delayed re-entry).
    out_of_scope_due_uids = sorted(due_uids - scope)
    next_scope = next_review_scope_from_projection(projection)
    previous = _previous_formal_review_snapshot(
        session, int(palace.id), exclude_session_id=str(row.id)
    )
    next_review_at = projection.get("next_review_at")
    # Projection may already emit offset-aware ISO; normalize when we own the value.
    if isinstance(next_review_at, datetime):
        next_review_at = to_api_datetime(next_review_at)
    return {
        "scope_node_count": len(scope),
        "rated_node_count": len(ratings),
        "unrated_due_node_count": len(unrated_uids),
        "unrated_node_uids": unrated_uids,
        "out_of_scope_due_node_count": len(out_of_scope_due_uids),
        "out_of_scope_due_node_uids": out_of_scope_due_uids,
        "rating_counts": counts,
        "mastery_progress": projection["mastery_progress"],
        "mastery_percent": projection["mastery_percent"],
        "memory_health": projection["memory_health"],
        "memory_health_percent": projection["memory_health_percent"],
        "remaining_due_node_count": projection["due_node_count"],
        "next_review_at": next_review_at,
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

    # Cheap unrated discovery: session events + frozen scope (no full FSRS rollup).
    scope = set(_scope(row))
    current = _effective_ratings(session, row, scope) if scope else {}
    unrated_uids = sorted(scope - set(current))
    already_rated_count = len(current)
    if not unrated_uids:
        summary = formal_review_completion_summary(session, row)
        return {
            "affected_node_count": 0,
            "affected_node_uids": [],
            "skipped_rated_node_count": already_rated_count,
            "operation_ids": [],
            "summary": summary,
        }

    # Stable per-node ids keep retries idempotent without clobbering siblings.
    node_ops = [
        (node_uid, f"{batch_id}:{index}"[:64])
        for index, node_uid in enumerate(unrated_uids)
    ]
    batch = rate_nodes_batch_single(
        session,
        palace_id=int(row.palace_id),
        node_operation_ids=node_ops,
        rating=rating,
        study_session_id=str(row.id),
        conflict_policy="skip_direct",
        source_scene="formal_review",
        recall_round="first",
        rating_source="manual",
        commit=True,
    )
    refreshed = formal_review_completion_summary(session, row)
    return {
        "affected_node_count": int(batch["affected_node_count"]),
        "affected_node_uids": list(batch["affected_node_uids"]),
        "skipped_rated_node_count": already_rated_count,
        "operation_ids": list(batch["operation_ids"]),
        "summary": refreshed,
    }


def rate_out_of_scope_due_formal_review_nodes(
    session: Session,
    row: StudySession,
    *,
    rating: int,
    operation_id: str,
) -> dict[str, Any]:
    """Settlement helper: rate palace due nodes outside this session's frozen set.

    Used when node-mode review settled its branch but other branches remain due.
    Temporarily expands formal single-rating scope so rate_nodes accepts them.
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
    target_uids = [
        str(uid) for uid in (summary.get("out_of_scope_due_node_uids") or []) if uid
    ]
    if not target_uids:
        # Fall back to live due list minus frozen scope (projection may lag after commits).
        frozen = set(_scope(row))
        target_uids = [
            uid
            for uid in list_due_nodes(session, int(row.palace_id))
            if uid not in frozen
        ]
    if not target_uids:
        return {
            "affected_node_count": 0,
            "affected_node_uids": [],
            "skipped_rated_node_count": int(summary.get("rated_node_count") or 0),
            "operation_ids": [],
            "summary": summary,
        }

    # Expand frozen scope for this write so formal single ratings are accepted.
    summary_json = _json(row.summary_json)
    original_frozen = list(summary_json.get("frozen_due_node_uids") or [])
    expanded = sorted({*original_frozen, *target_uids})
    summary_json["frozen_due_node_uids"] = expanded
    summary_json["scope_expanded_for_out_of_scope_rating"] = True
    row.summary_json = json.dumps(summary_json, ensure_ascii=False)
    session.flush()

    node_ops = [
        (node_uid, f"{batch_id}:oos:{index}"[:64])
        for index, node_uid in enumerate(target_uids)
    ]
    batch = rate_nodes_batch_single(
        session,
        palace_id=int(row.palace_id),
        node_operation_ids=node_ops,
        rating=rating,
        study_session_id=str(row.id),
        conflict_policy="skip_direct",
        source_scene="formal_review",
        recall_round="first",
        rating_source="manual",
        commit=True,
    )
    # Keep expanded scope so completion counts include the extra ratings.
    # Do not shrink back — otherwise settlement would report unrated ghosts.

    refreshed = formal_review_completion_summary(session, row)
    return {
        "affected_node_count": int(batch["affected_node_count"]),
        "affected_node_uids": list(batch["affected_node_uids"]),
        "skipped_rated_node_count": int(summary.get("rated_node_count") or 0),
        "operation_ids": list(batch["operation_ids"]),
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
    # Palace-wave rule: only complete when every frozen item was rated (direct or inherited).
    # Unrated items must use pause — never implicit advance.
    if int(summary.get("unrated_due_node_count") or 0) > 0 and completion_mode not in {
        "force_complete_unrated",  # reserved; not exposed as default UI
    }:
        raise ValueError(
            "wave has unrated frozen nodes; pause and save instead of complete"
        )
    ratings = summary.pop("ratings")
    score = round(sum(ratings.values()) / len(ratings)) if ratings else 0
    ended_at = utc_now_naive()
    wave_id = existing.get("wave_id")
    if not wave_id:
        finalize_formal_review_schedules(
            session,
            study_session_id=str(row.id),
            palace_id=int(palace.id),
            finalized_at=ended_at,
        )
    if wave_id:
        from memory_anki.modules.reviews.application.wave_service import complete_formal_wave

        try:
            complete_formal_wave(session, str(wave_id), allow_incomplete=False)
        except ValueError:
            # Race: counts may have drifted; surface as incomplete.
            raise
    # Receipt due/next fields must reflect post-finalize schedules.
    projection = get_palace_memory_projection(session, palace.id)
    summary["remaining_due_node_count"] = projection["due_node_count"]
    next_review_at = projection["next_review_at"]
    if isinstance(next_review_at, datetime):
        next_review_at = to_api_datetime(next_review_at)
    summary["next_review_at"] = next_review_at
    summary["mastery_progress"] = projection["mastery_progress"]
    summary["mastery_percent"] = projection["mastery_percent"]
    summary["memory_health"] = projection["memory_health"]
    summary["memory_health_percent"] = projection["memory_health_percent"]
    # Recompute out-of-scope after finalize (usually 0 when whole wave was rated).
    scope = set(_scope(row))
    due_uids = {
        str(item["node_uid"])
        for item in projection["nodes"]
        if item.get("due") and item.get("node_uid")
    }
    out_of_scope = sorted(due_uids - scope)
    summary["out_of_scope_due_node_count"] = len(out_of_scope)
    summary["out_of_scope_due_node_uids"] = out_of_scope
    summary.update(next_review_scope_from_projection(projection))
    # Receipt "上次复习" is this just-finished session; keep previous mastery for delta.
    summary["last_review_at"] = to_api_datetime(ended_at)
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
