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


def _source_id(normalized: Plan, card_id: str) -> str:
    occ = _find_occurrence(normalized, card_id)
    if occ is None:
        return card_id
    return _text(occ.get("source_card_id")) or card_id


def _passed(normalized: Plan, card_id: str, completed: set[str]) -> bool:
    if card_id in completed:
        return True
    occ = _find_occurrence(normalized, card_id)
    return occ is not None and occ.get("status") == OCCURRENCE_COMPLETED


def _group_members(normalized: Plan, source_id: str) -> list[str]:
    members: list[str] = []

    def add(card_id: object) -> None:
        text = _text(card_id)
        if text and text not in members:
            members.append(text)

    add(source_id)
    for card in normalized["original_cards"]:
        if _text(card.get("card_id")) == source_id:
            add(card.get("card_id"))
    for occ in normalized["occurrences"]:
        if _text(occ.get("source_card_id")) == source_id:
            add(occ.get("occurrence_id"))
    return members


def compressible_ids(plan: Mapping[str, Any] | None) -> list[str]:
    """Passed groups with no live retry.

    A pass on the source or on its 重练 settles the whole group, so a weak
    first try does not stay behind a passed retry. Weak groups with a live
    retry stay. Ratings remain on the original cards.
    """
    normalized = normalize_plan(plan)
    live_sources = live_retry_sources(normalized)
    compressed = set(normalized["compressed_ids"])
    excluded = set(normalized["excluded_ids"])
    completed = set(normalized["completed_ids"])
    ids: list[str] = []
    seen_sources: set[str] = set()
    seeds = [
        *normalized["presented_ids"],
        *[card.get("card_id") for card in normalized["original_cards"]],
        *[occ.get("occurrence_id") for occ in normalized["occurrences"]],
    ]
    for card_id in seeds:
        target = _text(card_id)
        if not target:
            continue
        source_id = _source_id(normalized, target)
        if not source_id or source_id in seen_sources:
            continue
        seen_sources.add(source_id)
        if source_id in live_sources:
            continue
        members = _group_members(normalized, source_id)
        if not any(_passed(normalized, member, completed) for member in members):
            continue
        for member in members:
            if member in compressed or member in excluded or member in ids:
                continue
            ids.append(member)
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
