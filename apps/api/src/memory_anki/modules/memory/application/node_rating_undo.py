"""Rating undo (session-local LIFO) and completion-time schedule re-anchoring.

Split out of ``node_memory_service`` so the rating write path stays readable.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewRatingOperation,
    ReviewRatingOperationItem,
)
from memory_anki.modules.memory.application.node_memory_projection import (
    _clear_due_rollup_cache,
    _load_palace_node_states,
    _naive,
    _rating_mutation_projection,
    _restore_state,
    _tree,
)


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
    # Post-settlement undo: reopen completed formal session + wave so wave items
    # leave ITEM_DONE and reconcile_rating_undo can restore pending membership.
    study_row = session.get(StudySession, study_session_id)
    if (
        study_row is not None
        and study_row.scene in {"review", "reinforcement_review"}
        and study_row.status == "completed"
    ):
        from memory_anki.modules.memory.application.formal_review_service import (
            reopen_formal_review_for_amendment,
        )

        reopen_formal_review_for_amendment(session, study_row)
    palace = session.get(Palace, operation.palace_id)
    if palace is None:
        raise ValueError("palace not found")
    root_uid, nodes = _tree(palace)
    before_states = _load_palace_node_states(session, operation.palace_id)
    before = _rating_mutation_projection(
        session, palace, root_uid=root_uid, nodes=nodes, states=before_states
    )
    items = session.query(ReviewRatingOperationItem).filter_by(operation_id=operation_id).all()
    current_wave_ids = {
        item.node_uid: (
            session.query(ReviewNodeState.effective_wave_id)
            .filter(
                ReviewNodeState.palace_id == operation.palace_id,
                ReviewNodeState.node_uid == item.node_uid,
            )
            .scalar()
        )
        for item in items
    }
    from memory_anki.modules.memory.application.wave_service import (
        reconcile_rating_undo,
    )

    for item in items:
        snapshot = json.loads(item.before_state_json) if item.before_state_json else None
        _restore_state(session, operation.palace_id, item.node_uid, snapshot)
        reconcile_rating_undo(
            session,
            palace_id=operation.palace_id,
            node_uid=item.node_uid,
            operation_id=operation_id,
            target_wave_id=current_wave_ids.get(item.node_uid),
            restored_wave_id=(snapshot or {}).get("effective_wave_id"),
        )
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
    review clock must not start until the learner clicks complete — otherwise
    short-interval cards go overdue while the session is still open and the
    palace reappears as due immediately after completion.

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
