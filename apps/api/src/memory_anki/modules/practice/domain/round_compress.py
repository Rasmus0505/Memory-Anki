"""Compress passed freestyle cards out of the working set. Framework-free."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .round_plan import (
    OCCURRENCE_COMPLETED,
    Plan,
    live_retry_sources,
    normalize_plan,
)
from .round_plan_values import _append_unique, _find_occurrence, _text


def compressible_ids(plan: Mapping[str, Any] | None) -> list[str]:
    """Passed cards with no live retry. Weak-rated sources and their 重练 stay."""
    normalized = normalize_plan(plan)
    live_sources = live_retry_sources(normalized)
    compressed = set(normalized["compressed_ids"])
    excluded = set(normalized["excluded_ids"])
    completed = set(normalized["completed_ids"])
    ids: list[str] = []
    seen: set[str] = set()
    for card_id in normalized["presented_ids"]:
        target = _text(card_id)
        if not target or target in seen or target in compressed or target in excluded:
            continue
        occ = _find_occurrence(normalized, target)
        source_id = _text(occ.get("source_card_id")) if occ is not None else target
        if source_id in live_sources:
            continue
        if target in completed or (occ is not None and occ["status"] == OCCURRENCE_COMPLETED):
            seen.add(target)
            ids.append(target)
    return ids


def compress_completed(
    plan: Mapping[str, Any],
    settlement: Mapping[str, Any] | None = None,
) -> Plan:
    """Drop passed cards from the working set and keep the 小结算 snapshot for 大结算."""
    next_plan = normalize_plan(plan)
    if settlement:
        next_plan["partial_settlements"] = [
            *next_plan.get("partial_settlements", []),
            dict(settlement),
        ]
        next_plan = normalize_plan(next_plan)
    ids = compressible_ids(next_plan)
    if not ids:
        return next_plan
    for card_id in ids:
        _append_unique(next_plan["compressed_ids"], card_id)
    return normalize_plan(next_plan)
