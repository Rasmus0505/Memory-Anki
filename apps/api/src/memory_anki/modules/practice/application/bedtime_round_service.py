"""睡前复习 round commands: candidate count, append, and plan-only grading.

The round lifecycle (locking, idempotency receipts, versioning) stays in
``round_state_service``; this module is the thin 睡前复习 command layer on top of
it. Rating here writes only the plan -- no Reviews session or scheduling write.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..domain.round_plan import append_bedtime_cards, apply_bedtime_rating
from .bedtime_review import collect_bedtime_cards
from .round_state_service import (
    _apply_plan,
    _commit_operation,
    _local_today,
    _operation_seen,
    _plan_of,
    _require_operation_id,
    _row_by_id,
    _serve,
    _text,
)


def bedtime_candidates(session: Session, *, round_id: str) -> dict[str, Any]:
    """How many of today's rated cards are not in the bedtime queue yet."""
    row = _row_by_id(session, round_id)
    if row is None:
        raise ValueError("freestyle round not found")
    cards = collect_bedtime_cards(session, _plan_of(row), workspace=row.workspace)
    return {"round_id": row.round_id, "count": len(cards), "cards": cards}


def append_bedtime_review(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
) -> dict[str, Any]:
    """Append today's newly rated cards to the end of the current round.

    Idempotent per ``operation_id``. Re-clicking the moon button after rating
    more cards appends only the units that are not already in the bedtime queue.
    """
    op_id = _require_operation_id(operation_id)
    row = _row_by_id(session, round_id)
    if row is None:
        raise ValueError("freestyle round not found")
    if _operation_seen(session, row, op_id):
        return {
            "round": _serve(session, row, duplicate=True),
            "cards": [],
            "added_card_ids": [],
        }
    if int(expected_version or 0) > 0 and int(row.version or 0) != int(expected_version):
        return {"round": _serve(session, row, conflict=True), "cards": [], "added_card_ids": []}
    if row.status != "active":
        raise ValueError("freestyle round is not active")
    plan = _plan_of(row)
    cards = collect_bedtime_cards(session, plan, workspace=row.workspace)
    next_plan, added = append_bedtime_cards(plan, cards, today=_local_today())
    if not added:
        row.last_operation_id = op_id
        return {"round": _serve(session, row), "cards": [], "added_card_ids": []}
    changed = _apply_plan(row, next_plan, operation_id=op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return {"round": _serve(session, row, conflict=True), "cards": [], "added_card_ids": []}
    added_set = set(added)
    return {
        "round": _serve(session, row),
        "cards": [card for card in cards if _text(card.get("id")) in added_set],
        "added_card_ids": added,
    }


def rate_bedtime_card(
    session: Session,
    *,
    round_id: str,
    operation_id: str,
    expected_version: int,
    card_id: str,
    rating: int,
) -> dict[str, Any]:
    """Record one bedtime grade on the plan only.

    No Reviews session, encounter, or rating operation is created, so the unit's
    due date and FSRS card are exactly where they were. The plan marks the card
    completed so the queue moves on.
    """
    op_id = _require_operation_id(operation_id)
    row = _row_by_id(session, round_id)
    if row is None:
        raise ValueError("freestyle round not found")
    if _operation_seen(session, row, op_id):
        return {"round": _serve(session, row, duplicate=True)}
    if int(expected_version or 0) > 0 and int(row.version or 0) != int(expected_version):
        return {"round": _serve(session, row, conflict=True)}
    if row.status != "active":
        raise ValueError("freestyle round is not active")
    plan = apply_bedtime_rating(
        _plan_of(row),
        card_id=card_id,
        rating=int(rating),
        today=_local_today(),
    )
    changed = _apply_plan(row, plan, operation_id=op_id)
    if not changed:
        row.last_operation_id = op_id
    if not _commit_operation(session, row, op_id):
        return {"round": _serve(session, row, conflict=True)}
    return {"round": _serve(session, row)}


__all__ = ["append_bedtime_review", "bedtime_candidates", "rate_bedtime_card"]
