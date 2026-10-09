"""Natural append vs config replan for a freestyle round plan."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .round_plan import (
    OCCURRENCE_CANCELLED,
    OCCURRENCE_COMPLETED,
    OCCURRENCE_INSERTED,
    OCCURRENCE_PENDING,
    RETRY_GAP,
    Plan,
    _day,
    _find_occurrence,
    _insert_retry_inplace,
    _known_presented_ids,
    _match_key,
    _repair_current,
    _review_unit_id,
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


def repair_retries_parked_before_source(plan: Plan) -> None:
    """Move an inserted retry that sits at or before its source to after it.

    Inserting into an empty ``presented_ids`` parks the copy at index 0. The
    next append then stacks the real cards behind it, so the last card cannot
    page forward into 重练. A retry already after its source is left alone.
    """
    for occ in list(plan["occurrences"]):
        if occ.get("status") != OCCURRENCE_INSERTED:
            continue
        occ_id = _text(occ.get("occurrence_id"))
        source_id = _text(occ.get("source_card_id"))
        presented = list(plan["presented_ids"])
        if (
            not occ_id
            or not source_id
            or occ_id not in presented
            or source_id not in presented
            or presented.index(occ_id) > presented.index(source_id)
        ):
            continue
        presented = [item for item in presented if item != occ_id]
        plan["presented_ids"] = presented
        occ["status"] = OCCURRENCE_PENDING
        _insert_retry_inplace(plan, occ_id, presented.index(source_id))


def drop_vanished_unstarted(
    plan: Mapping[str, Any],
    live_unit_ids: set[str],
) -> Plan:
    """Drop cards whose review unit can no longer be opened.

    ``live_unit_ids`` are units that are still active on a palace that has not
    been deleted or archived. A vanished unit is removed even when this round
    still has a live retry for it: the retry cannot open either, and leaving
    it on screen is a dead wall. Quiz cards (empty ``unit_id``), completed
    cards, and excluded cards stay in the round history, but a retry of a
    vanished unit does not: opening it is the same dead wall. A vanished
    current card moves to the next unfinished card.
    """
    next_plan = normalize_plan(plan)
    live = {_text(item) for item in live_unit_ids if _text(item)}
    completed = set(next_plan["completed_ids"])
    excluded = set(next_plan["excluded_ids"])
    kept: list[dict[str, Any]] = []
    dropped: set[str] = set()
    unopenable_sources: set[str] = set()
    for item in next_plan["original_cards"]:
        unit_id = _text(item.get("unit_id"))
        card_id = item["card_id"]
        vanished = bool(unit_id) and unit_id not in live
        if vanished:
            unopenable_sources.add(card_id)
        protected = (
            not unit_id
            or card_id in completed
            or card_id in excluded
        )
        if vanished and not protected:
            dropped.add(card_id)
            continue
        kept.append(item)
    kept_occurrences = [
        occ
        for occ in next_plan["occurrences"]
        if _text(occ.get("source_card_id")) not in unopenable_sources
    ]
    if not dropped and kept_occurrences == list(next_plan["occurrences"]):
        return next_plan
    next_plan["original_cards"] = kept
    next_plan["occurrences"] = kept_occurrences
    next_plan["encounters"] = {
        key: value
        for key, value in next_plan["encounters"].items()
        if key not in dropped
    }
    known = _known_presented_ids(next_plan)
    next_plan["presented_ids"] = [
        item for item in next_plan["presented_ids"] if item in known
    ]
    _repair_current(next_plan)
    return next_plan


def drop_undue_unstarted(
    plan: Mapping[str, Any],
    due_unit_ids: set[str],
) -> Plan:
    """Drop unstarted cards the opener will refuse as not due.

    A frozen round used to keep active units whose ``due_date`` is still in the
    future, but opening them returns "review unit is not due". Skip then lands
    on the next one and a rebuild puts the same cards back. Quiz cards,
    completed cards, excluded cards, live retry sources, and cards that already
    have an encounter stay. A dropped current card moves to the next unfinished
    card. Callers pass units that are due today; anything else with a unit id
    is treated as not openable.
    """
    next_plan = normalize_plan(plan)
    due = {_text(item) for item in due_unit_ids if _text(item)}
    completed = set(next_plan["completed_ids"])
    excluded = set(next_plan["excluded_ids"])
    retry_sources = live_retry_sources(next_plan)
    open_cards = {_text(key) for key in next_plan["encounters"] if _text(key)}
    kept: list[dict[str, Any]] = []
    dropped: set[str] = set()
    for item in next_plan["original_cards"]:
        unit_id = _text(item.get("unit_id")) or _review_unit_id(item.get("card_id"))
        card_id = item["card_id"]
        undue = bool(unit_id) and unit_id not in due
        protected = (
            not unit_id
            or card_id in completed
            or card_id in excluded
            or card_id in retry_sources
            or card_id in open_cards
        )
        if undue and not protected:
            dropped.add(card_id)
            continue
        kept.append(item)
    if not dropped:
        return next_plan
    next_plan["original_cards"] = kept
    next_plan["occurrences"] = [
        occ
        for occ in next_plan["occurrences"]
        if _text(occ.get("source_card_id")) not in dropped
    ]
    next_plan["encounters"] = {
        key: value
        for key, value in next_plan["encounters"].items()
        if key not in dropped
    }
    known = _known_presented_ids(next_plan)
    next_plan["presented_ids"] = [
        item for item in next_plan["presented_ids"] if item in known
    ]
    _repair_current(next_plan)
    return next_plan


def append_today_cards(
    plan: Mapping[str, Any],
    cards: Sequence[Mapping[str, Any]],
    *,
    today: str = "",
) -> Plan:
    """Natural due rebuild: freeze leftover order, append newly seen identities."""
    next_plan = normalize_plan(plan)
    previous_day = _day(next_plan.get("today"))
    stamp = _day(today) or previous_day
    day_advanced = bool(previous_day and stamp and previous_day < stamp)
    if stamp:
        next_plan["today"] = stamp
    incoming = snapshot_cards(cards, today=stamp)
    if day_advanced:
        _reopen_due_again(next_plan, incoming)
    _merge_incoming(
        next_plan,
        incoming,
        keep_old={item["card_id"] for item in next_plan["original_cards"]},
        today=stamp,
        stamp_new=True,
    )
    incoming_ids = [item["card_id"] for item in incoming]
    incoming_units = {
        item["card_id"]: _text(item.get("unit_id")) or _review_unit_id(item.get("card_id"))
        for item in incoming
    }
    compressed = set(next_plan["compressed_ids"])
    excluded = set(next_plan["excluded_ids"])
    excluded_units = _blocked_unit_ids(next_plan, excluded)
    for card_id in incoming_ids:
        if card_id in compressed or card_id in excluded:
            continue
        unit = incoming_units.get(card_id) or ""
        # A newer revision of a unit already removed from this queue stays out.
        if unit and unit in excluded_units:
            continue
        if card_id not in next_plan["presented_ids"]:
            next_plan["presented_ids"].append(card_id)
    known = _known_presented_ids(next_plan)
    next_plan["presented_ids"] = [item for item in next_plan["presented_ids"] if item in known]
    # Sources must already be in the queue. Repairing before the append would
    # miss a retry that was inserted into an empty list and then followed by
    # the real cards.
    repair_retries_parked_before_source(next_plan)
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
    previous_day = _day(next_plan.get("today"))
    stamp = _day(today) or previous_day
    day_advanced = bool(previous_day and stamp and previous_day < stamp)
    if stamp:
        next_plan["today"] = stamp
    incoming = snapshot_cards(cards, today=stamp)
    if day_advanced:
        _reopen_due_again(next_plan, incoming)
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
    compressed = set(next_plan["compressed_ids"])
    retry_sources = live_retry_sources(next_plan)
    prefix: list[str] = []
    seen: set[str] = set()
    for card_id in previous_presented:
        source_id = _source_id_of(next_plan, card_id)
        if not source_id or source_id in seen or source_id in excluded or source_id in compressed:
            continue
        if source_id not in source_ids:
            continue
        if source_id in completed or source_id in retry_sources:
            prefix.append(source_id)
            seen.add(source_id)
    incoming_ids = [item["card_id"] for item in incoming]
    incoming_units = {
        item["card_id"]: _text(item.get("unit_id")) or _review_unit_id(item.get("card_id"))
        for item in incoming
    }
    excluded_units = _blocked_unit_ids(next_plan, excluded)
    suffix: list[str] = []
    for card_id in incoming_ids:
        if card_id in seen or card_id in excluded or card_id in completed or card_id in compressed:
            continue
        unit = incoming_units.get(card_id) or ""
        if unit and unit in excluded_units:
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


def _reopen_due_again(plan: Plan, incoming: Sequence[Mapping[str, Any]]) -> None:
    """Put cards that are due again back into today's queue.

    Only runs after the calendar day advances. A removal stays removed.
    Inserted or completed retries are cancelled, or the source still looks
    finished after it leaves ``completed_ids``.
    """
    due_ids = {_text(item.get("card_id")) for item in incoming}
    due_ids.discard("")
    if not due_ids:
        return
    excluded = set(plan["excluded_ids"])
    finished = {OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}
    reopen = {
        card_id
        for card_id in due_ids
        if card_id not in excluded
        and (
            card_id in plan["completed_ids"]
            or card_id in plan["compressed_ids"]
            or any(
                _text(item.get("source_card_id")) == card_id and item.get("status") in finished
                for item in plan["occurrences"]
            )
        )
    }
    if not reopen:
        return
    drop_ids = set(reopen)
    for item in plan["occurrences"]:
        if _text(item.get("source_card_id")) not in reopen:
            continue
        if item.get("status") in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}:
            item["status"] = OCCURRENCE_CANCELLED
        occ_id = _text(item.get("occurrence_id"))
        if occ_id:
            drop_ids.add(occ_id)
            plan["encounters"].pop(occ_id, None)
    for card_id in reopen:
        plan["encounters"].pop(card_id, None)
    plan["completed_ids"] = [item for item in plan["completed_ids"] if item not in drop_ids]
    plan["compressed_ids"] = [item for item in plan["compressed_ids"] if item not in drop_ids]
    if drop_ids - reopen:
        plan["presented_ids"] = [
            item for item in plan["presented_ids"] if item not in (drop_ids - reopen)
        ]


def _blocked_unit_ids(plan: Mapping[str, Any], blocked_ids: set[str]) -> set[str]:
    """Units already removed or finished, including ids that only live on the card id."""
    units: set[str] = set()
    for card_id in blocked_ids:
        unit = _review_unit_id(card_id)
        if unit:
            units.add(unit)
    for item in plan.get("original_cards") or []:
        if not isinstance(item, Mapping) or item.get("card_id") not in blocked_ids:
            continue
        unit = _text(item.get("unit_id")) or _review_unit_id(item.get("card_id"))
        if unit:
            units.add(unit)
    return units


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
    plan["compressed_ids"] = _rewrite_ids(plan["compressed_ids"], mapping)
    plan["partial_settlements"] = [
        {
            **item,
            "card_ids": _rewrite_ids(item.get("card_ids") or [], mapping),
        }
        for item in plan.get("partial_settlements") or []
        if isinstance(item, Mapping)
    ]
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
