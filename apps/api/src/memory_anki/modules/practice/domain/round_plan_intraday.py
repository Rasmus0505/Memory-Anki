"""Time-spaced same-day occurrences for a freestyle round.

A failed grade and a first-pass re-check are both *waiting* work: the occurrence
exists in the plan but is not on the rail until ``available_at``. Keeping this
next to (not inside) the plan algebra avoids growing ``round_plan.py`` past its
size budget and keeps the wall-clock rule in one readable place.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from .round_plan import (
    OCCURRENCE_PENDING,
    Plan,
    _cohort_of,
    _collapse_retries,
    _cursor_index,
    _find_occurrence,
    _insert_retry_inplace,
    _max_attempt,
    _predicted_insert_index,
    _sync_index,
    _text,
    occurrence_id_for,
)


def available_at(item: Mapping[str, Any], now: datetime) -> bool:
    raw = _text(item.get("available_at"))
    if not raw:
        return True
    try:
        return datetime.fromisoformat(raw) <= now
    except ValueError:
        return True


def plan_waiting(plan: Mapping[str, Any]) -> dict[str, Any]:
    """What is still owed today but not yet servable, and when it is."""
    pending = [
        item for item in plan.get("occurrences") or []
        if isinstance(item, Mapping)
        and item.get("status") == OCCURRENCE_PENDING
        and item.get("available_at")
    ]
    ready_at = min((str(item["available_at"]) for item in pending), default=None)
    return {"count": len(pending), "next_ready_at": ready_at}


def publish_ready_retries(plan: Plan, *, now: datetime) -> Plan:
    """Move every pending occurrence whose wait has elapsed onto the rail."""
    held_current = plan.get("current_card_id")
    published = False
    for item in list(plan.get("occurrences") or []):
        if not isinstance(item, dict) or item.get("status") != OCCURRENCE_PENDING:
            continue
        if not available_at(item, now):
            continue
        occ_id = _text(item.get("occurrence_id"))
        if not occ_id or _find_occurrence(plan, occ_id) is None:
            continue
        _insert_retry_inplace(plan, occ_id, _cursor_index(plan, plan["presented_ids"]))
        published = True
    if published:
        if held_current and _text(held_current) in plan["presented_ids"]:
            plan["current_card_id"] = held_current
        _sync_index(plan)
    return plan


def append_step_occurrence(
    plan: Plan,
    *,
    source_id: str,
    source_unit_id: str,
    round_id: str,
    available_at: datetime,
) -> None:
    """A first pass waits for one short re-check; it is not a retry."""
    attempt = _max_attempt(plan, source_id) + 1
    source_key = source_unit_id or source_id
    plan["occurrences"].append({
        "occurrence_id": occurrence_id_for(round_id, source_key, attempt),
        "source_card_id": source_id,
        "source_unit_id": source_unit_id,
        "retry_attempt": attempt,
        "rating": None,
        "insert_target_index": _predicted_insert_index(plan, source_id),
        "status": OCCURRENCE_PENDING,
        "encounter_id": "",
        "entered_on": _cohort_of(plan, source_id),
        "available_at": available_at.isoformat(),
        "kind": "step",
    })
    _collapse_retries(plan)
    _sync_index(plan)


__all__ = [
    "append_step_occurrence",
    "available_at",
    "plan_waiting",
    "publish_ready_retries",
]
