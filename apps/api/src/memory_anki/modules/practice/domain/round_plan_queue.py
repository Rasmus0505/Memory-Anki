"""移出后恢复与手动排序的纯队列规则。"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .round_plan_normalization import _sync_index, normalize_plan
from .round_plan_values import _int, _review_unit_id, _text, _unique

Plan = dict[str, Any]


def restore_card(plan: Mapping[str, Any], card_id: str) -> Plan:
    next_plan = normalize_plan(plan)
    target = _text(card_id)
    if not target:
        raise ValueError("card_id is required")
    # A silent rebuild may have rebound this unit onto its current revision
    # while the removal sheet still holds the older id.
    unit_id = _review_unit_id(target)
    if unit_id:
        target = next(
            (item["card_id"] for item in next_plan["original_cards"]
             if item.get("unit_id") == unit_id),
            target,
        )
    next_plan["excluded_ids"] = [item for item in next_plan["excluded_ids"] if item != target]
    _sync_index(next_plan)
    return next_plan


def reorder_unscored_cards(plan: Mapping[str, Any], order_ids: Sequence[str]) -> Plan:
    """Reorder unscored rows while keeping every handled row in its slot."""
    next_plan = normalize_plan(plan)
    presented = list(next_plan["presented_ids"])
    original_ids = {item["card_id"] for item in next_plan["original_cards"]}
    locked = (
        set(next_plan["completed_ids"])
        | set(next_plan["excluded_ids"])
        | set(next_plan["compressed_ids"])
        | set(next_plan["bedtime_ratings"])
    )
    locked.update(
        card_id for card_id, encounter in next_plan["encounters"].items()
        if _int(encounter.get("rating")) in {1, 2, 3, 4}
    )
    locked.update(
        item["card_id"] for item in next_plan["original_cards"]
        if item.get("bedtime") or item.get("palace_pass")
    )
    locked.update(
        _text(item.get("occurrence_id"))
        for item in next_plan["occurrences"]
        if _text(item.get("occurrence_id"))
    )
    locked.update(
        _text(item.get("source_card_id"))
        for item in next_plan["occurrences"]
        if item.get("status") in {"pending", "inserted"}
    )
    movable = [card_id for card_id in presented if card_id in original_ids and card_id not in locked]
    allowed = set(movable)
    requested = [card_id for card_id in _unique(order_ids) if card_id in allowed]
    requested.extend(card_id for card_id in movable if card_id not in requested)
    cursor = iter(requested)
    next_plan["presented_ids"] = [
        next(cursor) if card_id in allowed else card_id
        for card_id in presented
    ]
    _sync_index(next_plan)
    return next_plan
