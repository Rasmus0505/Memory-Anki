"""Node-level FSRS rating mutations (rate / undo / session finalize)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fsrs import Rating
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewRatingOperation,
    ReviewRatingOperationItem,
)
from memory_anki.modules.reviews.application.fsrs_runtime import (
    RATING_LABELS,
    VALID_RATINGS,
    cap_weak_rating_due,
    ensure_strong_rating_due,
)
from memory_anki.modules.reviews.application.node_memory_projection import (
    _apply_card,
    _card_from_state,
    _card_id,
    _clear_due_rollup_cache,
    _descendants,
    _event_id,
    _latest_ratings_for_palace,
    _load_palace_node_states,
    _naive,
    _rating_mutation_projection,
    _restore_state,
    _scheduler,
    _session_rated_uids,
    _state_dict,
    _tree,
    _utc_now,
    due_node_uids_for_entry,
    get_completion_summary,
    get_palace_due_rollup,
    get_palace_mastery_trend,
    get_palace_memory_projection,
    list_due_nodes,
)
from memory_anki.modules.reviews.application.node_due_rollup_batch import (
    project_due_rollups_batch,
)

# Public re-exports keep existing import paths stable.
__all__ = [
    "RATING_LABELS",
    "VALID_RATINGS",
    "due_node_uids_for_entry",
    "finalize_formal_review_schedules",
    "get_completion_summary",
    "get_palace_due_rollup",
    "get_palace_mastery_trend",
    "get_palace_memory_projection",
    "list_due_nodes",
    "project_due_rollups_batch",
    "rate_nodes",
    "undo_rating_operation",
]


def rate_nodes(
    session: Session,
    *,
    palace_id: int,
    node_uid: str,
    rating: int,
    study_session_id: str,
    operation_id: str,
    rating_scope: str = "subtree",
    conflict_policy: str = "overwrite",
    source_scene: str = "formal_review",
    recall_round: str = "first",
    rating_source: str = "manual",
    inference_confidence: float | None = None,
    response_ms: int | None = None,
    hint_count: int = 0,
    retry_count: int = 0,
) -> dict[str, Any]:
    if rating not in VALID_RATINGS:
        raise ValueError("rating must be between 1 and 4")
    if rating_scope not in {"single", "subtree"}:
        raise ValueError("rating_scope must be single or subtree")
    if conflict_policy not in {"overwrite", "skip_direct"}:
        raise ValueError("conflict_policy must be overwrite or skip_direct")
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    existing = session.get(ReviewRatingOperation, operation_id)
    if existing is not None:
        if (
            existing.study_session_id != study_session_id
            or existing.palace_id != palace_id
            or existing.root_node_uid != node_uid
            or existing.rating != rating
            or existing.rating_scope != rating_scope
        ):
            raise ValueError("rating operation belongs to another request")
        root_uid, nodes = _tree(palace)
        states = _load_palace_node_states(session, palace_id)
        return {
            "operation_id": operation_id,
            "affected_node_count": existing.affected_node_count,
            "idempotent": True,
            **_rating_mutation_projection(
                session,
                palace,
                root_uid=root_uid,
                nodes=nodes,
                states=states,
            ),
        }
    root_uid, nodes = _tree(palace)
    if node_uid not in nodes:
        raise ValueError("node not found")
    selected = (
        [node_uid] if rating_scope == "single" else [node_uid, *_descendants(nodes, node_uid)]
    )
    selected = [uid for uid in selected if uid != root_uid]
    # Formal single ratings stay inside the frozen due scope so accidental leaf
    # clicks outside this session do not mutate distant cards. Subtree ratings
    # intentionally write the full document descendants (including non-due /
    # unrevealed nodes) so parent scores cascade regardless of expand state.
    if (
        rating_scope == "single"
        and source_scene == "formal_review"
        and (
            study_session_id.startswith("review-")
            or session.get(StudySession, study_session_id) is not None
        )
    ):
        from memory_anki.modules.reviews.application.formal_review_service import (
            get_formal_review_scope,
        )

        selected = [
            uid
            for uid in selected
            if uid in get_formal_review_scope(session, study_session_id, palace_id)
        ]
    if conflict_policy == "skip_direct" and rating_scope == "subtree":
        # "避开": leave every already-scored descendant alone (direct or
        # batch_inherited). Otherwise a mid-node subtree score (hard on child +
        # grandchildren) is half-overwritten when the parent later chooses 避开 —
        # only the direct child was skipped, grandchildren got the parent score.
        already_rated_uids = _session_rated_uids(
            session,
            study_session_id=study_session_id,
            palace_id=palace_id,
            recall_round=recall_round,
        )
        # Always re-rate the target node; skip descendants that already have a score.
        selected = [uid for uid in selected if uid == node_uid or uid not in already_rated_uids]
    if not selected:
        if node_uid == root_uid:
            raise ValueError("root node cannot be scheduled alone; rate descendants or expand scope")
        raise ValueError("没有可评分节点（可能不在本次复习范围，或子树节点均已评分并选择避开）")
    operation = ReviewRatingOperation(
        id=operation_id,
        study_session_id=study_session_id,
        palace_id=palace_id,
        root_node_uid=node_uid,
        rating=rating,
        rating_scope=rating_scope,
        affected_node_count=len(selected),
    )
    session.add(operation)
    # One tree parse + one full-palace state load shared by before/after rollups
    # and the FSRS write loop (no per-node ReviewNodeState SELECTs).
    states = _load_palace_node_states(session, palace_id)
    reviewed_now = _utc_now()
    before_projection = _rating_mutation_projection(
        session,
        palace,
        root_uid=root_uid,
        nodes=nodes,
        states=states,
        now=reviewed_now,
    )
    before_ratings = _latest_ratings_for_palace(session, palace_id, selected)
    scheduler = _scheduler(session)
    events: list[MindMapRecallEvent] = []
    items: list[ReviewRatingOperationItem] = []
    for uid in selected:
        row = states.get(uid)
        before = _state_dict(row)
        before_rating = before_ratings.get(uid)
        fingerprint = nodes[uid]["content_fingerprint"]
        # Content edit invalidates prior schedule, but the unique key is still
        # (palace_id, node_uid). Keep the existing row and start a fresh card
        # instead of INSERT (which raised IntegrityError → HTTP 500).
        schedule_row = (
            row if row is not None and row.content_fingerprint == fingerprint else None
        )
        card = _card_from_state(schedule_row, card_id=_card_id(palace_id, uid))
        # Legacy migration seeds often carry multi-week overdue clocks. Rating them
        # "as late but remembered" inflates stability into mastery 100% in one pass.
        # Normalize clocks (not S/D) right before the first real FSRS write.
        if schedule_row is not None and (
            schedule_row.state_source == "legacy_estimate"
            or "legacy" in str(schedule_row.parameter_version or "").lower()
        ):
            from memory_anki.modules.reviews.application.legacy_fsrs_repair import (
                normalize_legacy_card_clock,
            )

            card = normalize_legacy_card_clock(card)
        card, _log = scheduler.review_card(card, Rating(rating), review_datetime=reviewed_now)
        # 忘记/困难 → 十几分钟到半小时内再遇到；记得/轻松至少多日（学习步不回 1h）。
        card = cap_weak_rating_due(card, rating, now=reviewed_now)
        card = ensure_strong_rating_due(card, rating, now=reviewed_now)
        if row is None:
            row = ReviewNodeState(palace_id=palace_id, node_uid=uid)
            session.add(row)
            states[uid] = row
        _apply_card(row, card, fingerprint=fingerprint, source="manual")
        event_id = _event_id(operation_id, uid)
        events.append(
            MindMapRecallEvent(
                id=event_id,
                study_session_id=study_session_id,
                palace_id=palace_id,
                node_uid=uid,
                source_scene=source_scene,
                recall_round=recall_round,
                rating=rating,
                rating_source=rating_source,
                rating_scope=rating_scope,
                evidence_origin="direct" if uid == node_uid else "batch_inherited",
                inference_confidence=inference_confidence,
                operation_id=operation_id,
                response_ms=response_ms,
                hint_count=max(0, hint_count),
                retry_count=max(0, retry_count),
            )
        )
        items.append(
            ReviewRatingOperationItem(
                operation_id=operation_id,
                palace_id=palace_id,
                node_uid=uid,
                event_id=event_id,
                before_state_json=json.dumps(before, ensure_ascii=False) if before else None,
                after_state_json=json.dumps(_state_dict(row), ensure_ascii=False),
                before_rating=before_rating,
            )
        )
    session.add_all(events)
    session.add_all(items)
    session.flush()
    _clear_due_rollup_cache(session)
    # Reuse the same in-memory ORM rows (already mutated) for after rollup.
    after_projection = _rating_mutation_projection(
        session,
        palace,
        root_uid=root_uid,
        nodes=nodes,
        states=states,
        now=reviewed_now,
    )
    session.commit()
    return {
        "operation_id": operation_id,
        "affected_node_count": len(selected),
        "affected_node_uids": selected,
        "previous_mastery_progress": before_projection["mastery_progress"],
        "current_mastery_progress": after_projection["mastery_progress"],
        "previous_memory_health": before_projection["memory_health"],
        "current_memory_health": after_projection["memory_health"],
        "next_review_at": after_projection["next_review_at"],
        "due_node_count": after_projection["due_node_count"],
        "undo_available": True,
        **after_projection,
    }


def undo_rating_operation(
    session: Session, *, operation_id: str, study_session_id: str
) -> dict[str, Any]:
    operation = session.get(ReviewRatingOperation, operation_id)
    if operation is None:
        raise ValueError("rating operation not found")
    if operation.study_session_id != study_session_id:
        raise ValueError("rating operation belongs to another session")
    if operation.undone_at is not None:
        return {"operation_id": operation_id, "undone": True, "idempotent": True}
    newer = (
        session.query(ReviewRatingOperation)
        .filter(
            ReviewRatingOperation.study_session_id == study_session_id,
            ReviewRatingOperation.created_at > operation.created_at,
            ReviewRatingOperation.undone_at.is_(None),
        )
        .first()
    )
    if newer is not None:
        raise ValueError("only the latest rating operation can be undone")
    palace = session.get(Palace, operation.palace_id)
    if palace is None:
        raise ValueError("palace not found")
    root_uid, nodes = _tree(palace)
    before_states = _load_palace_node_states(session, operation.palace_id)
    before = _rating_mutation_projection(
        session, palace, root_uid=root_uid, nodes=nodes, states=before_states
    )
    items = session.query(ReviewRatingOperationItem).filter_by(operation_id=operation_id).all()
    for item in items:
        snapshot = json.loads(item.before_state_json) if item.before_state_json else None
        _restore_state(session, operation.palace_id, item.node_uid, snapshot)
    operation.undone_at = utc_now_naive()
    session.flush()
    _clear_due_rollup_cache(session)
    # Restore may delete or recreate rows; one post-flush load is cheaper than
    # a second full projection with ratings + nodes[].
    after_states = _load_palace_node_states(session, operation.palace_id)
    after = _rating_mutation_projection(
        session, palace, root_uid=root_uid, nodes=nodes, states=after_states
    )
    session.commit()
    return {
        "operation_id": operation_id,
        "undone": True,
        "affected_node_count": len(items),
        "previous_mastery_progress": before["mastery_progress"],
        "current_mastery_progress": after["mastery_progress"],
        **after,
    }


def finalize_formal_review_schedules(
    session: Session,
    *,
    study_session_id: str,
    palace_id: int,
    finalized_at: datetime | None = None,
) -> int:
    """Re-anchor schedules for nodes rated in a formal session to completion time.

    Mid-session ratings still write FSRS S/D for undo and progress, but the
    review clock must not start until the learner clicks complete. Otherwise
    忘记/困难 (capped at 10/30 minutes from the click) become overdue while
    the session is still open, and the palace reappears as due immediately
    after completion.

    Preserves each card's current FSRS parameters and intended interval length;
    only shifts ``last_review_at`` / ``due_at`` so the interval originates at
    session completion. Undone operations are ignored.
    """
    finalized = _naive(finalized_at) or utc_now_naive()
    if finalized.tzinfo is not None:
        finalized = finalized.astimezone(UTC).replace(tzinfo=None)

    op_ids = [
        op_id
        for (op_id,) in session.query(ReviewRatingOperation.id)
        .filter(
            ReviewRatingOperation.study_session_id == study_session_id,
            ReviewRatingOperation.palace_id == palace_id,
            ReviewRatingOperation.undone_at.is_(None),
        )
        .all()
    ]
    if not op_ids:
        return 0

    node_uids = {
        node_uid
        for (node_uid,) in session.query(ReviewRatingOperationItem.node_uid)
        .filter(ReviewRatingOperationItem.operation_id.in_(op_ids))
        .all()
    }
    if not node_uids:
        return 0

    rows = (
        session.query(ReviewNodeState)
        .filter(
            ReviewNodeState.palace_id == palace_id,
            ReviewNodeState.node_uid.in_(node_uids),
        )
        .all()
    )
    changed = 0
    for row in rows:
        if row.due_at is None or row.last_review_at is None:
            continue
        interval = row.due_at - row.last_review_at
        if interval.total_seconds() < 0:
            interval = timedelta(0)
        # Re-applying with the same finalized_at is idempotent: interval is
        # preserved so a second call keeps last/due at finalized + interval.
        if row.last_review_at == finalized and row.due_at == finalized + interval:
            continue
        row.last_review_at = finalized
        row.due_at = finalized + interval
        row.updated_at = finalized
        changed += 1

    if changed:
        session.flush()
        _clear_due_rollup_cache(session)
    return changed
