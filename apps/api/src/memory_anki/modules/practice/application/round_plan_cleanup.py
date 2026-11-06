"""Rebuild-time cleanup of round-plan cards whose review units changed.

Split out of ``round_state_service`` so the service module stays inside its size
budget. These helpers own one question: after a permanent-mark edit, does a plan
card still open, and if its unit was retired, which live unit continues its
content?
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import local_day
from memory_anki.modules.memory.api import (
    list_active_review_unit_ids,
    list_due_review_unit_ids,
    resolve_unit_successors,
)
from memory_anki.modules.practice.domain.round_rebind import (
    drop_undue_unstarted,
    drop_vanished_unstarted,
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def plan_unit_ids(plan: dict[str, Any]) -> list[str]:
    cards = [item for item in plan.get("original_cards") or [] if isinstance(item, dict)]
    return [_text(item.get("unit_id")) for item in cards if _text(item.get("unit_id"))]


def plan_card_units(plan: dict[str, Any]) -> list[tuple[str, str]]:
    return [
        (_text(item.get("card_id")), _text(item.get("unit_id")))
        for item in plan.get("original_cards") or []
        if isinstance(item, dict)
    ]


def without_vanished_units(session: Session, plan: dict[str, Any]) -> dict[str, Any]:
    unit_ids = plan_unit_ids(plan)
    if not unit_ids:
        return plan
    # A permanent-mark removal retires the edited unit and folds its nodes into
    # the parent/residual unit. Follow that content into the live unit so the
    # current card stays on the same material instead of jumping elsewhere.
    successors = resolve_unit_successors(session, unit_ids)
    live_ids = set(list_active_review_unit_ids(session, unit_ids))
    # The successor is live by construction but may not be one of the plan's
    # own unit ids, so it is not in the lookup above.
    live_ids.update(successors.values())
    return drop_vanished_unstarted(plan, live_ids, successors=successors)


def without_undue_units(session: Session, plan: dict[str, Any]) -> dict[str, Any]:
    """Drop unstarted cards the opener refuses because they are not due today."""
    unit_ids = plan_unit_ids(plan)
    if not unit_ids:
        return plan
    due_ids = list_due_review_unit_ids(session, unit_ids, today=local_day())
    return drop_undue_unstarted(plan, due_ids)


__all__ = [
    "plan_card_units",
    "plan_unit_ids",
    "without_undue_units",
    "without_vanished_units",
]
