"""Pure freestyle round-plan rules. Framework-free."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .overlay_quiz import normalize_overlay_quiz

RETRY_GAP = 3
FAIL_RATINGS = {1, 2}
PASS_RATINGS = {3, 4}
OCCURRENCE_PENDING = "pending"
OCCURRENCE_INSERTED = "inserted"
OCCURRENCE_COMPLETED = "completed"
OCCURRENCE_CANCELLED = "cancelled"

Plan = dict[str, Any]

def empty_plan() -> Plan:
    return {
        "original_cards": [],
        "presented_ids": [],
        "current_card_id": None,
        "current_index": 0,
        "completed_ids": [],
        "excluded_ids": [],
        "occurrences": [],
        "encounters": {},
    }


def snapshot_cards(cards: Sequence[Mapping[str, Any]] | None) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for card in cards or ():
        card_id = _text(card.get("card_id") or card.get("id"))
        if not card_id or card_id in seen or card_id.startswith("retry:") or _text(card.get("occurrence_kind")) == "retry":
            continue
        seen.add(card_id)
        path = card.get("context_path")
        label = _text(card.get("label"))
        if not label and isinstance(path, list) and path:
            last = path[-1]
            if isinstance(last, dict):
                label = _text(last.get("text"))
        result.append(
            {
                "card_id": card_id,
                "unit_id": _text(card.get("unit_id")),
                "unit_revision": _int(card.get("unit_revision")),
                "kind": _text(card.get("kind") or card.get("type")) or "card",
                "palace_id": _palace_id(card.get("palace_id")),
                "palace_title": _text(card.get("palace_title")),
                "label": label or card_id,
            }
        )
    return result


def plan_from_cards(cards: Sequence[Mapping[str, Any]] | None) -> Plan:
    plan = empty_plan()
    original = snapshot_cards(cards)
    presented = [item["card_id"] for item in original]
    plan["original_cards"] = original
    plan["presented_ids"] = presented
    plan["current_card_id"] = presented[0] if presented else None
    plan["current_index"] = 0
    return plan


def normalize_plan(plan: Mapping[str, Any] | None) -> Plan:
    raw = dict(plan or {})
    original = []
    for item in raw.get("original_cards") or []:
        if not isinstance(item, Mapping):
            continue
        card_id = _text(item.get("card_id"))
        if not card_id:
            continue
        original.append(
            {
                "card_id": card_id,
                "unit_id": _text(item.get("unit_id")),
                "unit_revision": _int(item.get("unit_revision")),
                "kind": _text(item.get("kind")) or "card",
                "palace_id": _palace_id(item.get("palace_id")),
                "palace_title": _text(item.get("palace_title")),
                "label": _text(item.get("label")) or card_id,
            }
        )
    occurrences = []
    for item in raw.get("occurrences") or []:
        if not isinstance(item, Mapping):
            continue
        occurrence_id = _text(item.get("occurrence_id"))
        if not occurrence_id:
            continue
        status = _text(item.get("status")) or OCCURRENCE_PENDING
        if status not in {
            OCCURRENCE_PENDING,
            OCCURRENCE_INSERTED,
            OCCURRENCE_COMPLETED,
            OCCURRENCE_CANCELLED,
        }:
            status = OCCURRENCE_PENDING
        rating = item.get("rating")
        occurrences.append(
            {
                "occurrence_id": occurrence_id,
                "source_card_id": _text(item.get("source_card_id")),
                "source_unit_id": _text(item.get("source_unit_id")),
                "retry_attempt": max(0, _int(item.get("retry_attempt"))),
                "rating": _int(rating) if rating not in (None, "") else None,
                "insert_target_index": max(0, _int(item.get("insert_target_index"))),
                "status": status,
                "encounter_id": _text(item.get("encounter_id")),
            }
        )
    encounters: dict[str, dict[str, Any]] = {}
    raw_encounters = raw.get("encounters") or {}
    if isinstance(raw_encounters, Mapping):
        for key, value in raw_encounters.items():
            card_id = _text(key)
            if not card_id or not isinstance(value, Mapping):
                continue
            encounters[card_id] = {
                "encounter_id": _text(value.get("encounter_id")),
                "status": _text(value.get("status")) or "open",
                "unit_revision": _int(value.get("unit_revision")),
            }
    presented = _unique(raw.get("presented_ids") or [item["card_id"] for item in original])
    current = raw.get("current_card_id")
    current_id = _text(current) if current not in (None, "") else None
    normalized: Plan = {
        "original_cards": original,
        "presented_ids": presented,
        "current_card_id": current_id,
        "current_index": max(0, _int(raw.get("current_index"))),
        "completed_ids": _unique(raw.get("completed_ids") or []),
        "excluded_ids": _unique(raw.get("excluded_ids") or []),
        "occurrences": occurrences,
        "encounters": encounters,
        "overlay_quiz": normalize_overlay_quiz(
            raw.get("overlay_quiz") if isinstance(raw.get("overlay_quiz"), Mapping) else None
        ),
    }
    _sync_index(normalized)
    return normalized


def occurrence_id_for(round_id: str, source_key: str, attempt: int) -> str:
    return f"retry:{_text(round_id)}:{_text(source_key)}:{max(1, int(attempt))}"


def apply_rating(
    plan: Mapping[str, Any],
    *,
    card_id: str,
    rating: int,
    encounter_id: str,
    occurrence_id: str = "",
    unit_id: str = "",
    round_id: str = "",
    unit_revision: int | None = None,
) -> Plan:
    next_plan = normalize_plan(plan)
    rated_id = _text(card_id)
    occ_id = _text(occurrence_id)
    if not rated_id and not occ_id:
        raise ValueError("card_id is required")
    rating_value = _int(rating)
    if rating_value not in FAIL_RATINGS and rating_value not in PASS_RATINGS:
        raise ValueError("rating must be 1-4")
    encounter = _text(encounter_id)
    if not encounter:
        raise ValueError("encounter_id is required")

    occ = _find_occurrence(next_plan, occ_id) or _find_occurrence(next_plan, rated_id)
    source_id = _text(occ.get("source_card_id") if occ else rated_id) or rated_id
    original = _original_card(next_plan, source_id)
    source_unit_id = _text(unit_id) or _text((original or {}).get("unit_id")) or (
        _text(occ.get("source_unit_id")) if occ else ""
    )
    revision = (
        _int(unit_revision)
        if unit_revision is not None
        else _int((original or {}).get("unit_revision"))
    )
    _set_encounter(next_plan, rated_id or source_id, encounter, revision, rating_value)
    if rated_id and rated_id != source_id:
        _set_encounter(next_plan, source_id, encounter, revision, rating_value)

    if rating_value in PASS_RATINGS:
        if occ is not None:
            occ["rating"] = rating_value
            occ["encounter_id"] = encounter
        _settle_source(next_plan, source_id)
        return next_plan

    _unsettle_source(next_plan, source_id)
    _fail_source(
        next_plan,
        source_id=source_id,
        source_unit_id=source_unit_id,
        encounter_id=encounter,
        rating=rating_value,
        round_id=round_id,
        occ=occ,
    )
    return next_plan


def leave_card(plan: Mapping[str, Any], card_id: str) -> Plan:
    next_plan = normalize_plan(plan)
    left_id = _text(card_id) or _text(next_plan.get("current_card_id"))
    if not left_id:
        return next_plan
    left_occ = _find_occurrence(next_plan, left_id)
    if (
        left_occ is not None
        and left_occ["status"] == OCCURRENCE_INSERTED
        and left_occ.get("rating") in FAIL_RATINGS
    ):
        left_occ["status"] = OCCURRENCE_COMPLETED
        _append_unique(next_plan["completed_ids"], left_id)
    source_id = _text(left_occ.get("source_card_id") if left_occ else left_id) or left_id
    presented = next_plan["presented_ids"]
    if left_id in presented:
        anchor_index = presented.index(left_id)
    elif source_id in presented:
        anchor_index = presented.index(source_id)
    else:
        anchor_index = int(next_plan.get("current_index") or 0)
    pending = [
        item
        for item in next_plan["occurrences"]
        if item["source_card_id"] == source_id and item["status"] == OCCURRENCE_PENDING
    ]
    for item in pending:
        _insert_retry_inplace(next_plan, item["occurrence_id"], anchor_index)
    _sync_index(next_plan)
    return next_plan


def insert_retry_after_gap(
    plan: Mapping[str, Any],
    occurrence_id: str,
    source_index: int,
) -> Plan:
    next_plan = normalize_plan(plan)
    _insert_retry_inplace(next_plan, occurrence_id, source_index)
    _sync_index(next_plan)
    return next_plan


def set_cursor(plan: Mapping[str, Any], card_id: str, *, commit: bool = True) -> Plan:
    next_plan = normalize_plan(plan)
    if not commit:
        return next_plan
    target = _text(card_id)
    if not target:
        return next_plan
    known = set(next_plan["presented_ids"])
    known.update(item["card_id"] for item in next_plan["original_cards"])
    known.update(item["occurrence_id"] for item in next_plan["occurrences"])
    if target not in known:
        raise ValueError("card is not in this round")
    next_plan["current_card_id"] = target
    _sync_index(next_plan)
    return next_plan


def skip_card(plan: Mapping[str, Any], card_id: str = "") -> Plan:
    next_plan = normalize_plan(plan)
    current = _text(card_id) or _text(next_plan.get("current_card_id"))
    nxt = next_unfinished_id(next_plan, after_id=current)
    next_plan["current_card_id"] = nxt
    _sync_index(next_plan)
    return next_plan


def complete_card(plan: Mapping[str, Any], card_id: str) -> Plan:
    next_plan = normalize_plan(plan)
    target = _text(card_id)
    if not target:
        raise ValueError("card_id is required")
    _append_unique(next_plan["completed_ids"], target)
    occ = _find_occurrence(next_plan, target)
    if occ is not None and occ["status"] == OCCURRENCE_INSERTED:
        occ["status"] = OCCURRENCE_COMPLETED
    elif occ is not None and occ["status"] == OCCURRENCE_PENDING:
        occ["status"] = OCCURRENCE_CANCELLED
    if _text(next_plan.get("current_card_id")) == target:
        next_plan["current_card_id"] = next_unfinished_id(next_plan, after_id=target)
    _sync_index(next_plan)
    return next_plan


def uncomplete_card(plan: Mapping[str, Any], card_id: str) -> Plan:
    """Drop a rating so the source card is unfinished again.

    Cancels retry copies that existed only because of that rating. The learner
    can stay on the card; this does not move the cursor.
    """
    next_plan = normalize_plan(plan)
    target = _text(card_id)
    if not target:
        raise ValueError("card_id is required")
    occ = _find_occurrence(next_plan, target)
    source_id = _text(occ.get("source_card_id") if occ else target) or target
    retry_ids = [
        _text(item.get("occurrence_id"))
        for item in next_plan["occurrences"]
        if _text(item.get("source_card_id")) == source_id
    ]
    drop = {item for item in (source_id, target, *retry_ids) if item}
    next_plan["completed_ids"] = [item for item in next_plan["completed_ids"] if item not in drop]
    for item in next_plan["occurrences"]:
        if _text(item.get("source_card_id")) != source_id:
            continue
        if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}:
            item["status"] = OCCURRENCE_CANCELLED
            item["rating"] = None
    retry_drop = {item for item in retry_ids if item}
    next_plan["presented_ids"] = [item for item in next_plan["presented_ids"] if item not in retry_drop]
    encounters = next_plan.get("encounters")
    if isinstance(encounters, dict):
        for key in (source_id, target):
            encounters.pop(key, None)
    _sync_index(next_plan)
    return next_plan


def exclude_card(plan: Mapping[str, Any], card_id: str) -> Plan:
    next_plan = normalize_plan(plan)
    target = _text(card_id)
    if not target:
        raise ValueError("card_id is required")
    _append_unique(next_plan["excluded_ids"], target)
    if _text(next_plan.get("current_card_id")) == target:
        next_plan["current_card_id"] = next_unfinished_id(next_plan, after_id=target)
    _sync_index(next_plan)
    return next_plan


def restore_card(plan: Mapping[str, Any], card_id: str) -> Plan:
    next_plan = normalize_plan(plan)
    target = _text(card_id)
    if not target:
        raise ValueError("card_id is required")
    next_plan["excluded_ids"] = [item for item in next_plan["excluded_ids"] if item != target]
    _sync_index(next_plan)
    return next_plan


def live_retry_sources(plan: Mapping[str, Any] | None) -> set[str]:
    normalized = normalize_plan(plan)
    return {
        item["source_card_id"]
        for item in normalized["occurrences"]
        if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED} and item["source_card_id"]
    }


def set_encounter(
    plan: Mapping[str, Any],
    card_id: str,
    encounter_id: str,
    *,
    unit_revision: int = 0,
    status: str = "open",
) -> Plan:
    next_plan = normalize_plan(plan)
    target = _text(card_id)
    encounter = _text(encounter_id)
    if not target:
        raise ValueError("card_id is required")
    if not encounter:
        raise ValueError("encounter_id is required")
    next_plan["encounters"][target] = {
        "encounter_id": encounter,
        "status": _text(status) or "open",
        "unit_revision": _int(unit_revision),
    }
    return next_plan


def next_unfinished_id(plan: Mapping[str, Any], after_id: str | None = None) -> str | None:
    normalized = normalize_plan(plan)
    presented = list(normalized["presented_ids"])
    after = _text(after_id)
    ordered: list[str] = []
    if after and after in presented:
        ordered.extend(presented[presented.index(after) + 1 :])
        ordered.extend(presented[: presented.index(after)])
    else:
        ordered.extend(presented)
    for card in normalized["original_cards"]:
        card_id = card["card_id"]
        if card_id not in ordered:
            ordered.append(card_id)
    seen: set[str] = set()
    for card_id in ordered:
        if card_id in seen:
            continue
        seen.add(card_id)
        if _is_unfinished(normalized, card_id):
            return card_id
    return None


def cleared_review_palace_ids(plan: Mapping[str, Any] | None) -> set[int]:
    """Palace ids whose review-unit cards in this round are all scored."""
    normalized = normalize_plan(plan)
    completed = set(normalized["completed_ids"])
    excluded = set(normalized["excluded_ids"])
    pending_sources = {
        item["source_card_id"]
        for item in normalized["occurrences"]
        if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}
    }
    by_palace: dict[int, list[str]] = {}
    for card in normalized["original_cards"]:
        if card.get("kind") != "mindmap_branch":
            continue
        palace_id = card.get("palace_id")
        if not palace_id:
            continue
        by_palace.setdefault(int(palace_id), []).append(card["card_id"])
    cleared: set[int] = set()
    for palace_id, card_ids in by_palace.items():
        if not card_ids:
            continue
        if any(card_id in pending_sources for card_id in card_ids):
            continue
        if any(card_id in excluded and card_id not in completed for card_id in card_ids):
            continue
        if any(card_id not in completed for card_id in card_ids):
            continue
        cleared.add(palace_id)
    return cleared


def rebind_plan_cards(
    plan: Mapping[str, Any],
    cards: Sequence[Mapping[str, Any]],
    *,
    reorder_unstarted: bool = False, drop_missing_unstarted: bool = False,
) -> Plan:
    next_plan = normalize_plan(plan)
    incoming = snapshot_cards(cards)
    if not incoming:
        _repair_current(next_plan)
        return next_plan

    old_by_key: dict[str, dict[str, Any]] = {}
    old_by_id: dict[str, dict[str, Any]] = {}
    for item in next_plan["original_cards"]:
        old_by_id[item["card_id"]] = item
        old_by_key[_match_key(item)] = item

    mapping: dict[str, str] = {}
    rebound: list[dict[str, Any]] = []
    used_old: set[str] = set()
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
                }
            )
            rebound.append(merged)
        else:
            rebound.append(card)

    keep_old = set(next_plan["completed_ids"]) | set(next_plan["excluded_ids"])
    if reorder_unstarted or drop_missing_unstarted:
        keep_old.update(_text(item.get("source_card_id")) for item in next_plan["occurrences"] if item.get("status") in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED})
    else:
        keep_old.update(item["card_id"] for item in next_plan["original_cards"])
    rebound.extend(item for item in next_plan["original_cards"] if item["card_id"] not in used_old and item["card_id"] in keep_old)
    next_plan["original_cards"] = rebound
    next_plan["presented_ids"] = _rewrite_ids(next_plan["presented_ids"], mapping)
    incoming_ids = [item["card_id"] for item in incoming]
    for card_id in incoming_ids:
        if card_id not in next_plan["presented_ids"]:
            next_plan["presented_ids"].append(card_id)
    next_plan["completed_ids"] = _rewrite_ids(next_plan["completed_ids"], mapping)
    next_plan["excluded_ids"] = _rewrite_ids(next_plan["excluded_ids"], mapping)
    current = _text(next_plan.get("current_card_id"))
    if current and current in mapping:
        next_plan["current_card_id"] = mapping[current]
    source_ids = {item["card_id"] for item in next_plan["original_cards"] if not item["card_id"].startswith("retry:")}
    rebound_by_unit = {_text(item.get("unit_id")): item["card_id"] for item in next_plan["original_cards"] if _text(item.get("unit_id")) and item["card_id"] in source_ids}
    for occ in next_plan["occurrences"]:
        mapped = mapping.get(occ["source_card_id"])
        if not mapped and occ["source_card_id"] not in source_ids:
            mapped = rebound_by_unit.get(_text(occ.get("source_unit_id")))
        if mapped:
            occ["source_card_id"] = mapped
    next_plan["encounters"] = {
        mapping.get(key, key): dict(value) for key, value in next_plan["encounters"].items()
    }
    if reorder_unstarted:
        next_plan["presented_ids"] = _reorder_unstarted_presented(next_plan, [item["card_id"] for item in incoming])
    known = _known_presented_ids(next_plan)
    next_plan["presented_ids"] = [item for item in next_plan["presented_ids"] if item in known]
    _repair_current(next_plan)
    return next_plan


def _reorder_unstarted_presented(plan: Plan, incoming_ids: Sequence[str]) -> list[str]:
    locked = _locked_presented_ids(plan)
    incoming_unstarted = [item for item in _unique(incoming_ids) if item not in locked]
    used: set[str] = set()
    result: list[str] = []
    cursor = 0
    for card_id in plan["presented_ids"]:
        if card_id in locked:
            if card_id not in used:
                result.append(card_id)
                used.add(card_id)
            continue
        while cursor < len(incoming_unstarted) and incoming_unstarted[cursor] in used:
            cursor += 1
        if cursor >= len(incoming_unstarted):
            continue
        nxt = incoming_unstarted[cursor]
        result.append(nxt)
        used.add(nxt)
        cursor += 1
    for card_id in incoming_unstarted:
        if card_id not in used:
            result.append(card_id)
            used.add(card_id)
    return result


def _locked_presented_ids(plan: Plan) -> set[str]:
    locked = set(plan["completed_ids"]) | set(plan["excluded_ids"])
    for item in plan["occurrences"]:
        status = item.get("status")
        if status in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}:
            source = _text(item.get("source_card_id"))
            if source:
                locked.add(source)
        if status == OCCURRENCE_INSERTED:
            occ_id = _text(item.get("occurrence_id"))
            if occ_id:
                locked.add(occ_id)
    return locked


def _known_presented_ids(plan: Plan) -> set[str]:
    known = {item["card_id"] for item in plan["original_cards"]}
    known.update(plan["completed_ids"])
    known.update(plan["excluded_ids"])
    for item in plan["occurrences"]:
        status = item.get("status")
        source = _text(item.get("source_card_id"))
        if source and status in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}:
            known.add(source)
        occ_id = _text(item.get("occurrence_id"))
        if occ_id and status == OCCURRENCE_INSERTED:
            known.add(occ_id)
    return known


def _is_viewable_current(plan: Plan, card_id: str) -> bool:
    if not card_id or card_id not in plan["presented_ids"] or card_id in plan["excluded_ids"]:
        return False
    occ = _find_occurrence(plan, card_id)
    if occ is not None:
        return occ["status"] == OCCURRENCE_INSERTED
    return card_id not in plan["completed_ids"]


def _repair_current(plan: Plan) -> None:
    current = _text(plan.get("current_card_id"))
    if current and _is_viewable_current(plan, current):
        _sync_index(plan)
        return
    nxt = next_unfinished_id(plan, after_id=current if current else None)
    if nxt is None:
        nxt = next_unfinished_id(plan)
    plan["current_card_id"] = nxt
    _sync_index(plan)


def _fail_source(
    plan: Plan,
    *,
    source_id: str,
    source_unit_id: str,
    encounter_id: str,
    rating: int,
    round_id: str,
    occ: dict[str, Any] | None,
) -> None:
    same = [
        item
        for item in plan["occurrences"]
        if item["encounter_id"] == encounter_id and item["status"] != OCCURRENCE_CANCELLED
    ]
    if same:
        for item in same:
            item["rating"] = rating
        return

    pending = [
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == source_id and item["status"] == OCCURRENCE_PENDING
    ]
    if pending:
        for item in pending:
            item["retry_attempt"] = int(item["retry_attempt"] or 0) + 1
            item["occurrence_id"] = occurrence_id_for(
                round_id,
                item["source_unit_id"] or source_unit_id or source_id,
                item["retry_attempt"],
            )
            item["rating"] = rating
            item["encounter_id"] = encounter_id
            item["insert_target_index"] = _predicted_insert_index(plan, source_id)
        return

    if occ is not None and occ["status"] == OCCURRENCE_INSERTED:
        occ["rating"] = rating
        occ["encounter_id"] = encounter_id

    attempt = _max_attempt(plan, source_id) + 1
    source_key = source_unit_id or source_id
    plan["occurrences"].append(
        {
            "occurrence_id": occurrence_id_for(round_id, source_key, attempt),
            "source_card_id": source_id,
            "source_unit_id": source_unit_id,
            "retry_attempt": attempt,
            "rating": rating,
            "insert_target_index": _predicted_insert_index(plan, source_id),
            "status": OCCURRENCE_PENDING,
            "encounter_id": encounter_id,
        }
    )


def _settle_source(plan: Plan, source_id: str) -> None:
    _append_unique(plan["completed_ids"], source_id)
    for item in plan["occurrences"]:
        if item["source_card_id"] != source_id:
            continue
        if item["status"] == OCCURRENCE_PENDING:
            item["status"] = OCCURRENCE_CANCELLED
        elif item["status"] == OCCURRENCE_INSERTED:
            item["status"] = OCCURRENCE_COMPLETED
            _append_unique(plan["completed_ids"], item["occurrence_id"])


def _unsettle_source(plan: Plan, source_id: str) -> None:
    target = _text(source_id)
    if not target:
        return
    plan["completed_ids"] = [item for item in plan["completed_ids"] if item != target]


def _insert_retry_inplace(plan: Plan, occurrence_id: str, source_index: int) -> None:
    occ_id = _text(occurrence_id)
    occ = _find_occurrence(plan, occ_id)
    if occ is None:
        raise ValueError("retry occurrence not found")
    if occ["status"] == OCCURRENCE_CANCELLED:
        return
    presented = [item for item in plan["presented_ids"] if item != occ_id]
    if occ["status"] == OCCURRENCE_INSERTED and occ_id in plan["presented_ids"]:
        return
    if not presented:
        insert_at = 0
        presented = [occ_id]
    else:
        anchor = max(0, min(_int(source_index), len(presented) - 1))
        insert_at = min(anchor + 1 + RETRY_GAP, len(presented))
        presented.insert(insert_at, occ_id)
    plan["presented_ids"] = presented
    occ["status"] = OCCURRENCE_INSERTED
    occ["insert_target_index"] = insert_at


def _predicted_insert_index(plan: Plan, source_id: str) -> int:
    presented = plan["presented_ids"]
    if source_id in presented:
        anchor = presented.index(source_id)
    else:
        current = _text(plan.get("current_card_id"))
        anchor = presented.index(current) if current and current in presented else 0
    return min(anchor + 1 + RETRY_GAP, len(presented))


def _is_unfinished(plan: Plan, card_id: str) -> bool:
    if not card_id:
        return False
    if card_id in plan["completed_ids"] or card_id in plan["excluded_ids"]:
        return False
    occ = _find_occurrence(plan, card_id)
    if occ is not None:
        return occ["status"] == OCCURRENCE_INSERTED
    for item in plan["occurrences"]:
        if item["source_card_id"] == card_id and item["status"] in {
            OCCURRENCE_PENDING,
            OCCURRENCE_INSERTED,
            OCCURRENCE_COMPLETED,
        }:
            return False
    return True


def _max_attempt(plan: Plan, source_id: str) -> int:
    attempts = [
        int(item.get("retry_attempt") or 0)
        for item in plan["occurrences"]
        if item.get("source_card_id") == source_id
    ]
    return max(attempts) if attempts else 0


def _find_occurrence(plan: Plan, occurrence_id: str) -> dict[str, Any] | None:
    target = _text(occurrence_id)
    if not target:
        return None
    for item in plan["occurrences"]:
        if item["occurrence_id"] == target:
            return item
    return None


def _original_card(plan: Plan, card_id: str) -> dict[str, Any] | None:
    target = _text(card_id)
    for item in plan["original_cards"]:
        if item["card_id"] == target:
            return item
    return None


def _set_encounter(plan: Plan, card_id: str, encounter_id: str, revision: int, rating: int) -> None:
    target = _text(card_id)
    if not target:
        return
    plan["encounters"][target] = {
        "encounter_id": encounter_id,
        "status": "passed" if rating in PASS_RATINGS else "failed",
        "unit_revision": _int(revision),
    }


def _sync_index(plan: Plan) -> None:
    current = _text(plan.get("current_card_id")) if plan.get("current_card_id") else None
    presented = plan["presented_ids"]
    if current and current in presented:
        plan["current_index"] = presented.index(current)
        plan["current_card_id"] = current
        return
    plan["current_card_id"] = current or None
    plan["current_index"] = 0


def _match_key(card: Mapping[str, Any]) -> str:
    unit_id = _text(card.get("unit_id"))
    if unit_id:
        return f"unit:{unit_id}"
    return f"card:{_text(card.get('card_id') or card.get('id'))}"


def _rewrite_ids(values: Sequence[Any], mapping: Mapping[str, str]) -> list[str]:
    rewritten: list[str] = []
    seen: set[str] = set()
    for raw in values:
        item = mapping.get(_text(raw), _text(raw))
        if not item or item in seen:
            continue
        seen.add(item)
        rewritten.append(item)
    return rewritten


def _append_unique(values: list[str], item: str) -> None:
    text = _text(item)
    if text and text not in values:
        values.append(text)


def _unique(values: Sequence[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        item = _text(raw)
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _text(value: Any) -> str:
    return str(value or "").strip()


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _palace_id(value: Any) -> int | None:
    try:
        number = int(value)
        return number if number > 0 else None
    except (TypeError, ValueError):
        return None
