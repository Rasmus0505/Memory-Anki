"""Natural append vs config replan for a freestyle round plan."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .round_plan import (
    OCCURRENCE_INSERTED,
    OCCURRENCE_PENDING,
    RETRY_GAP,
    Plan,
    _day,
    _find_occurrence,
    _known_presented_ids,
    _match_key,
    _repair_current,
    _rewrite_ids,
    _source_id_of,
    _text,
    live_retry_sources,
    normalize_plan,
    snapshot_cards,
)


def rebind_plan_cards(
    plan: Mapping[str, Any],
    cards: Sequence[Mapping[str, Any]],
    *,
    today: str = "",
    reorder_unstarted: bool = False,
    drop_missing_unstarted: bool = False,
) -> Plan:
    """Compatibility dispatcher. Prefer append_today_cards / replan_remaining."""
    if reorder_unstarted or drop_missing_unstarted:
        return replan_remaining(plan, cards, today=today)
    return append_today_cards(plan, cards, today=today)


def append_today_cards(
    plan: Mapping[str, Any],
    cards: Sequence[Mapping[str, Any]],
    *,
    today: str = "",
) -> Plan:
    """Natural due rebuild: freeze leftover order, append newly seen identities."""
    next_plan = normalize_plan(plan)
    stamp = _day(today) or _day(next_plan.get("today"))
    if stamp:
        next_plan["today"] = stamp
    incoming = snapshot_cards(cards, today=stamp)
    _merge_incoming(
        next_plan,
        incoming,
        keep_old={item["card_id"] for item in next_plan["original_cards"]},
        today=stamp,
        stamp_new=True,
    )
    incoming_ids = [item["card_id"] for item in incoming]
    for card_id in incoming_ids:
        if card_id not in next_plan["presented_ids"]:
            next_plan["presented_ids"].append(card_id)
    known = _known_presented_ids(next_plan)
    next_plan["presented_ids"] = [item for item in next_plan["presented_ids"] if item in known]
    _repair_current(next_plan)
    return next_plan


def replan_remaining(
    plan: Mapping[str, Any],
    cards: Sequence[Mapping[str, Any]],
    *,
    today: str = "",
) -> Plan:
    """Config save: keep handled ticks, rebuild unstarted, park live retries near the split."""
    next_plan = normalize_plan(plan)
    stamp = _day(today) or _day(next_plan.get("today"))
    if stamp:
        next_plan["today"] = stamp
    incoming = snapshot_cards(cards, today=stamp)
    keep_old = set(next_plan["completed_ids"]) | set(next_plan["excluded_ids"])
    keep_old.update(live_retry_sources(next_plan))
    previous_presented = list(next_plan["presented_ids"])
    mapping = _merge_incoming(
        next_plan,
        incoming,
        keep_old=keep_old,
        today=stamp,
        stamp_new=True,
    )
    previous_presented = _rewrite_ids(previous_presented, mapping)
    source_ids = {item["card_id"] for item in next_plan["original_cards"]}
    excluded = set(next_plan["excluded_ids"])
    completed = set(next_plan["completed_ids"])
    retry_sources = live_retry_sources(next_plan)
    prefix: list[str] = []
    seen: set[str] = set()
    for card_id in previous_presented:
        source_id = _source_id_of(next_plan, card_id)
        if not source_id or source_id in seen or source_id in excluded:
            continue
        if source_id not in source_ids:
            continue
        if source_id in completed or source_id in retry_sources:
            prefix.append(source_id)
            seen.add(source_id)
    incoming_ids = [item["card_id"] for item in incoming]
    suffix: list[str] = []
    for card_id in incoming_ids:
        if card_id in seen or card_id in excluded or card_id in completed:
            continue
        suffix.append(card_id)
        seen.add(card_id)
    if stamp:
        suffix_set = set(suffix)
        for item in next_plan["original_cards"]:
            if item["card_id"] in suffix_set:
                item["entered_on"] = stamp
    retry_ids: list[str] = []
    retry_seen: set[str] = set()
    for occ in next_plan["occurrences"]:
        if occ["status"] not in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}:
            continue
        occ_id = _text(occ.get("occurrence_id"))
        if not occ_id or occ_id in retry_seen:
            continue
        retry_seen.add(occ_id)
        if stamp:
            occ["entered_on"] = stamp
        occ["status"] = OCCURRENCE_INSERTED
        retry_ids.append(occ_id)
    gap = min(RETRY_GAP, len(suffix))
    presented = prefix + suffix[:gap] + retry_ids + suffix[gap:]
    next_plan["presented_ids"] = presented
    for offset, occ_id in enumerate(retry_ids):
        occ = _find_occurrence(next_plan, occ_id)
        if occ is not None:
            occ["insert_target_index"] = len(prefix) + gap + offset
    known = _known_presented_ids(next_plan)
    next_plan["presented_ids"] = [item for item in next_plan["presented_ids"] if item in known]
    _repair_current(next_plan)
    return next_plan


def _merge_incoming(
    plan: Plan,
    incoming: Sequence[Mapping[str, Any]],
    *,
    keep_old: set[str],
    today: str,
    stamp_new: bool,
) -> dict[str, str]:
    old_by_key: dict[str, dict[str, Any]] = {}
    old_by_id: dict[str, dict[str, Any]] = {}
    for item in plan["original_cards"]:
        old_by_id[item["card_id"]] = item
        old_by_key[_match_key(item)] = item

    mapping: dict[str, str] = {}
    rebound: list[dict[str, Any]] = []
    used_old: set[str] = set()
    stamp = _day(today)
    for card in incoming:
        key = _match_key(card)
        previous = old_by_key.get(key) or old_by_id.get(card["card_id"])
        if previous is not None and previous["card_id"] not in used_old:
            old_id = previous["card_id"]
            used_old.add(old_id)
            if old_id != card["card_id"]:
                mapping[old_id] = card["card_id"]
            merged = dict(previous)
            merged.update(
                {
                    "card_id": card["card_id"],
                    "unit_id": card["unit_id"] or previous.get("unit_id") or "",
                    "unit_revision": card["unit_revision"],
                    "kind": card["kind"] or previous.get("kind") or "card",
                    "palace_id": card["palace_id"]
                    if card["palace_id"] is not None
                    else previous.get("palace_id"),
                    "palace_title": card["palace_title"] or previous.get("palace_title") or "",
                    "label": card["label"] or previous.get("label") or card["card_id"],
                    "entered_on": _day(previous.get("entered_on")) or _day(card.get("entered_on")),
                }
            )
            rebound.append(merged)
        else:
            new_card = dict(card)
            if stamp_new and stamp and not _day(new_card.get("entered_on")):
                new_card["entered_on"] = stamp
            rebound.append(new_card)

    rebound.extend(
        item
        for item in plan["original_cards"]
        if item["card_id"] not in used_old and item["card_id"] in keep_old
    )
    plan["original_cards"] = rebound
    plan["presented_ids"] = _rewrite_ids(plan["presented_ids"], mapping)
    plan["completed_ids"] = _rewrite_ids(plan["completed_ids"], mapping)
    plan["excluded_ids"] = _rewrite_ids(plan["excluded_ids"], mapping)
    current = _text(plan.get("current_card_id"))
    if current and current in mapping:
        plan["current_card_id"] = mapping[current]
    source_ids = {
        item["card_id"] for item in plan["original_cards"] if not item["card_id"].startswith("retry:")
    }
    rebound_by_unit = {
        _text(item.get("unit_id")): item["card_id"]
        for item in plan["original_cards"]
        if _text(item.get("unit_id")) and item["card_id"] in source_ids
    }
    for occ in plan["occurrences"]:
        mapped = mapping.get(occ["source_card_id"])
        if not mapped and occ["source_card_id"] not in source_ids:
            mapped = rebound_by_unit.get(_text(occ.get("source_unit_id")))
        if mapped:
            occ["source_card_id"] = mapped
    plan["encounters"] = {
        mapping.get(key, key): dict(value) for key, value in plan["encounters"].items()
    }
    return mapping
