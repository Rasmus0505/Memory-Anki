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
    FAIL_RATINGS,
    OCCURRENCE_INSERTED,
    OCCURRENCE_PENDING,
    Plan,
    _cohort_of,
    _collapse_retries,
    _cursor_index,
    _find_occurrence,
    _insert_retry_inplace,
    _int,
    _max_attempt,
    _predicted_insert_index,
    _sync_index,
    _text,
    _unique,
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


def _waiting_occurrences(plan: Mapping[str, Any]):
    """Occurrences still owed today: never served, or a failed glance on the
    rail that reopens when its next attempt is due."""
    for item in plan.get("occurrences") or []:
        if not isinstance(item, Mapping) or not item.get("available_at"):
            continue
        status = item.get("status")
        if status == OCCURRENCE_PENDING:
            yield item
        elif status == OCCURRENCE_INSERTED and _int(item.get("rating")) in FAIL_RATINGS:
            # A retry the learner already rated 忘记/困难 stays on the rail as
            # history until its next attempt is due. It is still owed work.
            yield item


def plan_waiting(plan: Mapping[str, Any]) -> dict[str, Any]:
    """What is still owed today but not yet servable, and when it is."""
    waiting = list(_waiting_occurrences(plan))
    ready_at = min((str(item["available_at"]) for item in waiting), default=None)
    return {"count": len(waiting), "next_ready_at": ready_at}


def _reopen_occurrence(plan: Plan, item: dict[str, Any], *, keep_place: bool) -> None:
    """Turn a rated failed glance back into a blank, servable occurrence.

    The previous glance's score and encounter belong to that attempt; the next
    one starts unrated. ``keep_place`` keeps the card under the learner's
    viewport instead of reinserting it after the current card.
    """
    occ_id = _text(item.get("occurrence_id"))
    item["rating"] = None
    item["encounter_id"] = ""
    if occ_id:
        plan["encounters"].pop(occ_id, None)
    item["retry_attempt"] = max(1, _int(item.get("retry_attempt"))) + 1
    item["status"] = OCCURRENCE_INSERTED if keep_place else OCCURRENCE_PENDING
    # The wait has been consumed: from here the occurrence is servable work, not
    # a rated-but-not-due history row. Leaving the past instant attached made the
    # next read reopen and bump the same slot again.
    item["available_at"] = None


def publish_ready_retries(plan: Plan, *, now: datetime) -> Plan:
    """Move every owed occurrence whose wait has elapsed onto the rail.

    A retry the learner rated 忘记/困难 and left on the rail is reopened blank
    when its next attempt is due, then published right after the current card —
    the same slot as any other ready retry. Publication stays a read-time
    projection: the persisted row keeps its previous score until the next
    rating writes the new one.
    """
    held_current = _text(plan.get("current_card_id"))
    published = False
    reopened: list[str] = []
    for item in list(plan.get("occurrences") or []):
        if not isinstance(item, dict) or item.get("status") != OCCURRENCE_INSERTED:
            continue
        if _int(item.get("rating")) not in FAIL_RATINGS:
            continue
        occ_id = _text(item.get("occurrence_id"))
        if not occ_id or not item.get("available_at") or not available_at(item, now):
            continue
        if _find_occurrence(plan, occ_id) is None:
            continue
        keep_place = bool(held_current) and occ_id == held_current and occ_id in plan["presented_ids"]
        _reopen_occurrence(plan, item, keep_place=keep_place)
        reopened.append(occ_id)
        published = True
    for item in list(plan.get("occurrences") or []):
        if not isinstance(item, dict) or item.get("status") != OCCURRENCE_PENDING:
            continue
        if not available_at(item, now):
            continue
        occ_id = _text(item.get("occurrence_id"))
        if not occ_id or _find_occurrence(plan, occ_id) is None:
            continue
        # A reopened occurrence still sits in presented_ids as history; drop it
        # before resolving the cursor, or the old slot shifts the insert index.
        remaining = [card_id for card_id in plan["presented_ids"] if card_id != occ_id]
        _insert_retry_inplace(plan, occ_id, _cursor_index(plan, remaining))
        published = True
    if published:
        if held_current and held_current in plan["presented_ids"]:
            plan["current_card_id"] = held_current
        _sync_index(plan)
    if reopened:
        # The client must drop its local score/encounter for these ids; the
        # served plan is a fresh, unrated appearance.
        plan["fresh_due_ids"] = _unique([*(plan.get("fresh_due_ids") or []), *reopened])
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
