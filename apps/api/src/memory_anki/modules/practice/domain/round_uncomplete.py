"""Clear a cancelled freestyle rating from the round plan."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .round_plan import (
    OCCURRENCE_CANCELLED,
    OCCURRENCE_COMPLETED,
    OCCURRENCE_INSERTED,
    OCCURRENCE_PENDING,
    Plan,
    normalize_plan,
)


def uncomplete_card(plan: Mapping[str, Any], card_id: str) -> Plan:
    """Drop a rating so the source card is unfinished again.

    Cancels retry copies that existed only because of that rating. The learner
    can stay on the card; this does not move the cursor.
    """
    next_plan = normalize_plan(plan)
    target = str(card_id or "").strip()
    if not target:
        raise ValueError("card_id is required")
    occ = next(
        (item for item in next_plan["occurrences"] if item["occurrence_id"] == target),
        None,
    )
    source_id = str((occ or {}).get("source_card_id") or target).strip() or target
    retry_ids = {
        str(item.get("occurrence_id") or "").strip()
        for item in next_plan["occurrences"]
        if str(item.get("source_card_id") or "").strip() == source_id
    }
    drop = {item for item in (source_id, target, *retry_ids) if item}
    next_plan["completed_ids"] = [item for item in next_plan["completed_ids"] if item not in drop]
    for item in next_plan["occurrences"]:
        if str(item.get("source_card_id") or "").strip() != source_id:
            continue
        if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}:
            item["status"] = OCCURRENCE_CANCELLED
            item["rating"] = None
    next_plan["presented_ids"] = [item for item in next_plan["presented_ids"] if item not in retry_ids]
    encounters = next_plan.get("encounters")
    if isinstance(encounters, dict):
        for key in (source_id, target):
            encounters.pop(key, None)
    return normalize_plan(next_plan)
