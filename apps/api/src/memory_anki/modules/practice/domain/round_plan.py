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
        "today": "",
    }


def snapshot_cards(
    cards: Sequence[Mapping[str, Any]] | None,
    *,
    today: str = "",
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    stamp = _day(today)
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
                "entered_on": _day(card.get("entered_on")) or stamp,
            }
        )
    return result


def plan_from_cards(cards: Sequence[Mapping[str, Any]] | None, *, today: str = "") -> Plan:
    plan = empty_plan()
    original = snapshot_cards(cards, today=today)
    presented = [item["card_id"] for item in original]
    plan["original_cards"] = original
    plan["presented_ids"] = presented
    plan["current_card_id"] = presented[0] if presented else None
    plan["current_index"] = 0
    plan["today"] = _day(today)
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
                "entered_on": _day(item.get("entered_on")),
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
                "entered_on": _day(item.get("entered_on")),
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
        "today": _day(raw.get("today")),
        "overlay_quiz": normalize_overlay_quiz(
            raw.get("overlay_quiz") if isinstance(raw.get("overlay_quiz"), Mapping) else None
        ),
    }
    _collapse_retries(normalized)
    _sync_index(normalized)
    return normalized


def occurrence_id_for(round_id: str, source_key: str, attempt: int) -> str:
    return f"retry:{_text(round_id)}:{_text(source_key)}:{max(1, int(attempt))}"


def assert_rating_identity(
    plan: Mapping[str, Any],
    *,
    card_id: str,
    occurrence_id: str,
    encounter_id: str,
    unit_id: str = "",
) -> None:
    normalized = normalize_plan(plan)
    rated_id, occ_id = _text(card_id), _text(occurrence_id)
    requested_unit = _text(unit_id)
    if not _text(encounter_id):
        raise ValueError("encounter_id is required")
    if not rated_id and not occ_id:
        raise ValueError("card_id is required")
    if occ_id:
        occ = _find_occurrence(normalized, occ_id)
        if occ is None or (rated_id and rated_id != occ_id):
            raise ValueError("rating identity mismatch")
        source_id = _text(occ.get("source_card_id")) or occ_id
        original = _original_card(normalized, source_id)
        source_unit = _text((original or {}).get("unit_id")) or _text(occ.get("source_unit_id"))
    else:
        if _find_occurrence(normalized, rated_id) is not None:
            raise ValueError("rating identity mismatch")
        original = _original_card(normalized, rated_id)
        source_unit = _text((original or {}).get("unit_id"))
    if requested_unit and source_unit and requested_unit != source_unit:
        raise ValueError("rating identity mismatch")


def plan_is_fully_handled(plan: Mapping[str, Any] | None) -> bool:
    return next_unfinished_id(plan or {}) is None


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
    rated_id, occ_id, encounter = _text(card_id), _text(occurrence_id), _text(encounter_id)
    rating_value = _int(rating)
    if rating_value not in FAIL_RATINGS | PASS_RATINGS:
        raise ValueError("rating must be 1-4")
    assert_rating_identity(
        next_plan,
        card_id=rated_id,
        occurrence_id=occ_id,
        encounter_id=encounter,
        unit_id=unit_id,
    )
    occ = _find_occurrence(next_plan, occ_id) or _find_occurrence(next_plan, rated_id)
    source_id = _text(occ.get("source_card_id") if occ else rated_id) or rated_id
    original = _original_card(next_plan, source_id)
    source_unit_id = _text(unit_id) or _text((original or {}).get("unit_id")) or (
        _text(occ.get("source_unit_id")) if occ else ""
    )
    revision = _int(unit_revision) if unit_revision is not None else _int((original or {}).get("unit_revision"))
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
    from .round_rebind import repair_retries_parked_before_source
    repair_retries_parked_before_source(next_plan)
    left_id = _text(card_id) or _text(next_plan.get("current_card_id"))
    if not left_id:
        _sync_index(next_plan)
        return next_plan
    left_occ = _find_occurrence(next_plan, left_id)
    source_id = _text(left_occ.get("source_card_id") if left_occ else left_id) or left_id
    presented = next_plan["presented_ids"]
    if left_id in presented:
        anchor_index = presented.index(left_id)
    elif source_id in presented:
        anchor_index = presented.index(source_id)
    else:
        anchor_index = int(next_plan.get("current_index") or 0)
    if (
        left_occ is not None
        and left_occ["status"] == OCCURRENCE_INSERTED
        and left_occ.get("rating") in FAIL_RATINGS
    ):
        left_occ["retry_attempt"] = int(left_occ["retry_attempt"] or 0) + 1
        _reposition_retry_inplace(next_plan, left_occ["occurrence_id"], anchor_index)
        _sync_index(next_plan)
        return next_plan
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
    if after and after in presented:
        ordered = presented[presented.index(after) + 1 :] + presented[: presented.index(after)]
    else:
        ordered = list(presented)
    ordered.extend(card["card_id"] for card in normalized["original_cards"] if card["card_id"] not in ordered)
    seen: set[str] = set()
    for card_id in ordered:
        if card_id in seen:
            continue
        seen.add(card_id)
        if _is_unfinished(normalized, card_id):
            return card_id
    return None


def review_palace_ids(plan: Mapping[str, Any] | None) -> list[int]:
    """Palaces this round actually scheduled for review, in plan order.

    Quiz cards and retries are not review palaces. An empty plan is an empty
    scope: callers must not widen it to a subject or saved palace list.
    """
    normalized = normalize_plan(plan)
    ordered: list[int] = []
    seen: set[int] = set()
    for card in normalized["original_cards"]:
        if card.get("kind") != "mindmap_branch":
            continue
        palace_id = card.get("palace_id")
        if not palace_id:
            continue
        number = int(palace_id)
        if number in seen:
            continue
        seen.add(number)
        ordered.append(number)
    return ordered


def cleared_review_palace_ids(plan: Mapping[str, Any] | None) -> set[int]:
    normalized = normalize_plan(plan)
    completed, excluded = set(normalized["completed_ids"]), set(normalized["excluded_ids"])
    pending = {
        item["source_card_id"]
        for item in normalized["occurrences"]
        if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}
    }
    by_palace: dict[int, list[str]] = {}
    for card in normalized["original_cards"]:
        palace_id = card.get("palace_id")
        if card.get("kind") == "mindmap_branch" and palace_id:
            by_palace.setdefault(int(palace_id), []).append(card["card_id"])
    return {
        palace_id
        for palace_id, card_ids in by_palace.items()
        if card_ids
        and not any(card_id in pending for card_id in card_ids)
        and not any(card_id in excluded and card_id not in completed for card_id in card_ids)
        and all(card_id in completed for card_id in card_ids)
    }


def _known_presented_ids(plan: Plan) -> set[str]:
    known = {item["card_id"] for item in plan["original_cards"]}
    known.update(plan["completed_ids"])
    known.update(plan["excluded_ids"])
    live = {OCCURRENCE_PENDING, OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}
    for item in plan["occurrences"]:
        status = item.get("status")
        source, occ_id = _text(item.get("source_card_id")), _text(item.get("occurrence_id"))
        if source and status in live:
            known.add(source)
        if occ_id and status in {OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}:
            known.add(occ_id)
    return known


def _is_viewable_current(plan: Plan, card_id: str) -> bool:
    if not card_id or card_id not in plan["presented_ids"] or card_id in plan["excluded_ids"]:
        return False
    occ = _find_occurrence(plan, card_id)
    if occ is not None:
        return occ["status"] in {OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}
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
    rows = [item for item in plan["occurrences"] if item["source_card_id"] == source_id]
    same = [item for item in plan["occurrences"] if item["encounter_id"] == encounter_id and item["status"] != OCCURRENCE_CANCELLED]
    if same:
        for item in same:
            item["rating"] = rating
            _revive_occurrence(plan, item)
        _collapse_retries(plan)
        _publish_pending_retries(plan, source_id)
        return
    live = [item for item in rows if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}]
    completed = [item for item in rows if item["status"] == OCCURRENCE_COMPLETED]
    keep = occ if occ is not None and occ in live else (live[0] if live else None)
    if keep is None and completed:
        keep = occ if occ is not None and occ in completed else max(completed, key=lambda item: int(item.get("retry_attempt") or 0))
        _revive_occurrence(plan, keep)
    if keep is not None:
        keep["rating"] = rating
        keep["encounter_id"] = encounter_id
        if keep["status"] == OCCURRENCE_PENDING:
            keep["retry_attempt"] = int(keep["retry_attempt"] or 0) + 1
            keep["occurrence_id"] = occurrence_id_for(round_id, keep["source_unit_id"] or source_unit_id or source_id, keep["retry_attempt"])
            keep["insert_target_index"] = _predicted_insert_index(plan, source_id)
        elif keep["status"] != OCCURRENCE_INSERTED:
            keep["retry_attempt"] = int(keep["retry_attempt"] or 0) + 1
        _collapse_retries(plan)
        _publish_pending_retries(plan, source_id)
        return
    attempt = _max_attempt(plan, source_id) + 1
    source_key = source_unit_id or source_id
    plan["occurrences"].append({
        "occurrence_id": occurrence_id_for(round_id, source_key, attempt),
        "source_card_id": source_id,
        "source_unit_id": source_unit_id,
        "retry_attempt": attempt,
        "rating": rating,
        "insert_target_index": _predicted_insert_index(plan, source_id),
        "status": OCCURRENCE_PENDING,
        "encounter_id": encounter_id,
        "entered_on": _cohort_of(plan, source_id),
    })
    _collapse_retries(plan)
    _publish_pending_retries(plan, source_id)


def _publish_pending_retries(plan: Plan, source_id: str) -> None:
    """Put a weak rating's retry on the rail now. Do not move ``current_card_id``."""
    source_id = _text(source_id)
    if not source_id:
        return
    held_current = plan.get("current_card_id")
    presented = plan["presented_ids"]
    if source_id in presented:
        anchor = presented.index(source_id)
    else:
        current = _text(plan.get("current_card_id"))
        anchor = presented.index(current) if current and current in presented else int(plan.get("current_index") or 0)
    for item in list(plan["occurrences"]):
        if _text(item.get("source_card_id")) != source_id:
            continue
        if item.get("status") != OCCURRENCE_PENDING:
            continue
        _insert_retry_inplace(plan, _text(item.get("occurrence_id")), anchor)
    if held_current and _text(held_current) in plan["presented_ids"]:
        plan["current_card_id"] = held_current
    _sync_index(plan)


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


def _revive_occurrence(plan: Plan, occ: Mapping[str, Any]) -> None:
    item = occ if isinstance(occ, dict) else None
    if item is None or item.get("status") != OCCURRENCE_COMPLETED:
        return
    occ_id = _text(item.get("occurrence_id"))
    item["status"] = OCCURRENCE_INSERTED if occ_id in plan["presented_ids"] else OCCURRENCE_PENDING
    plan["completed_ids"] = [entry for entry in plan["completed_ids"] if entry != occ_id]


def _collapse_retries(plan: Plan) -> None:
    """A unit may keep only one retry occurrence in the feed at a time."""
    by_source: dict[str, list[dict[str, Any]]] = {}
    for item in plan["occurrences"]:
        source = _text(item.get("source_card_id"))
        if source and item["status"] != OCCURRENCE_CANCELLED:
            by_source.setdefault(source, []).append(item)
    drop_ids: set[str] = set()
    current = _text(plan.get("current_card_id"))
    kept_by_dropped: dict[str, str] = {}
    for items in by_source.values():
        if len(items) <= 1:
            continue
        live = [item for item in items if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}]
        pool = live or items
        keep = next((item for item in pool if item["occurrence_id"] == current), None) or max(
            pool,
            key=lambda item: (1 if item["status"] == OCCURRENCE_INSERTED else 0, int(item.get("retry_attempt") or 0)),
        )
        keep_id = _text(keep.get("occurrence_id"))
        for extra in items:
            extra_id = _text(extra.get("occurrence_id"))
            if extra is keep or not extra_id:
                continue
            extra["status"] = OCCURRENCE_CANCELLED
            drop_ids.add(extra_id)
            kept_by_dropped[extra_id] = keep_id
    if not drop_ids:
        return
    plan["presented_ids"] = [item for item in plan["presented_ids"] if item not in drop_ids]
    plan["completed_ids"] = [item for item in plan["completed_ids"] if item not in drop_ids]
    if current in drop_ids:
        plan["current_card_id"] = kept_by_dropped.get(current) or current


def _reposition_retry_inplace(plan: Plan, occurrence_id: str, vacated_index: int) -> None:
    occ_id = _text(occurrence_id)
    occ = _find_occurrence(plan, occ_id)
    if occ is None or occ["status"] == OCCURRENCE_CANCELLED:
        return
    presented = list(plan["presented_ids"])
    if occ_id not in presented:
        _insert_retry_inplace(plan, occ_id, vacated_index)
        return
    old = presented.index(occ_id)
    cohort = _day(occ.get("entered_on")) or _cohort_of(plan, occ["source_card_id"])
    if not occ.get("entered_on") and cohort:
        occ["entered_on"] = cohort
    segment_end = _segment_end(plan, presented, old, cohort)
    remaining_in_segment = max(0, segment_end - old - 1)
    insert_at = old + min(RETRY_GAP, remaining_in_segment)
    presented = [item for item in presented if item != occ_id]
    insert_at = max(0, min(insert_at, len(presented)))
    presented.insert(insert_at, occ_id)
    plan["presented_ids"] = presented
    occ["status"] = OCCURRENCE_INSERTED
    occ["insert_target_index"] = insert_at


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
        cohort = _day(occ.get("entered_on")) or _cohort_of(plan, occ["source_card_id"])
        if not occ.get("entered_on") and cohort:
            occ["entered_on"] = cohort
        segment_end = _segment_end(plan, presented, anchor, cohort)
        insert_at = min(anchor + 1 + RETRY_GAP, segment_end)
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
    cohort = _cohort_of(plan, source_id)
    segment_end = _segment_end(plan, presented, anchor, cohort)
    return min(anchor + 1 + RETRY_GAP, segment_end)


def _source_id_of(plan: Plan, card_id: str) -> str:
    target = _text(card_id)
    occ = _find_occurrence(plan, target)
    return (_text(occ.get("source_card_id")) or target) if occ else target


def _cohort_of(plan: Plan, card_id: str) -> str:
    occ = _find_occurrence(plan, card_id)
    if occ is not None:
        entered = _day(occ.get("entered_on"))
        if entered:
            return entered
        source_id = _text(occ.get("source_card_id")) or _text(card_id)
    else:
        source_id = _text(card_id)
    return _day((_original_card(plan, source_id) or {}).get("entered_on"))


def _segment_end(plan: Plan, presented: Sequence[str], anchor: int, cohort: str) -> int:
    end = min(max(anchor + 1, 0), len(presented))
    while end < len(presented) and _cohort_of(plan, presented[end]) == cohort:
        end += 1
    return end


def _day(value: Any) -> str:
    text = _text(value)
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return ""


def _is_unfinished(plan: Plan, card_id: str) -> bool:
    if not card_id or card_id in plan["completed_ids"] or card_id in plan["excluded_ids"]:
        return False
    occ = _find_occurrence(plan, card_id)
    if occ is not None:
        return occ["status"] == OCCURRENCE_INSERTED
    live = {OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}
    return not any(item["source_card_id"] == card_id and item["status"] in live for item in plan["occurrences"])


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
