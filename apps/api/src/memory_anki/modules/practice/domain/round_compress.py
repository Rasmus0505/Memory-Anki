"""Compress passed freestyle cards out of the working set. Framework-free."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .round_plan import (
    OCCURRENCE_COMPLETED,
    OCCURRENCE_INSERTED,
    OCCURRENCE_PENDING,
    PASS_RATINGS,
    Plan,
    normalize_plan,
)
from .round_plan_values import _append_unique, _find_occurrence, _text


def _source_id(normalized: Plan, card_id: str) -> str:
    occ = _find_occurrence(normalized, card_id)
    if occ is None:
        return card_id
    return _text(occ.get("source_card_id")) or card_id


def _retry_answered(normalized: Plan, occ: Mapping[str, Any]) -> bool:
    """The 重练 is done: passed this round, or explicitly completed.

    A weak 重练 (忘记/困难) is not done. It stays live and comes back
    (3张后重练), so a moved-past weak attempt must not settle its group.
    """
    if occ.get("status") == OCCURRENCE_COMPLETED:
        return True
    own = normalized["encounters"].get(_text(occ.get("occurrence_id")), {})
    return own.get("rating") in PASS_RATINGS


def _settled(normalized: Plan, card_id: str, completed: set[str]) -> bool:
    if card_id in completed:
        return True
    occ = _find_occurrence(normalized, card_id)
    return occ is not None and _retry_answered(normalized, occ)


def _unanswered_live_sources(normalized: Plan) -> set[str]:
    """Sources that still owe a 重练 which has not passed yet."""
    sources: set[str] = set()
    for occ in normalized["occurrences"]:
        if occ.get("status") not in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}:
            continue
        source = _text(occ.get("source_card_id"))
        if source and not _retry_answered(normalized, occ):
            sources.add(source)
    return sources


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
    """Settled groups with no live 重练 still owed a pass.

    A group settles when its source passed, or when one of its 重练 passed
    (or was explicitly completed). A group with a live 重练 that is still
    weak or unanswered stays, so the 3张后重练 comes back. Ratings remain on
    the original cards.
    """
    normalized = normalize_plan(plan)
    blocked = _unanswered_live_sources(normalized)
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
        if source_id in blocked:
            continue
        members = _group_members(normalized, source_id)
        if not any(_settled(normalized, member, completed) for member in members):
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
    """Drop settled cards from the working set and keep the 小结算 snapshot for 大结算."""
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
