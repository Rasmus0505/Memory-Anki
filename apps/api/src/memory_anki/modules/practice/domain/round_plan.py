"""Pure freestyle round-plan rules. Framework-free."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .round_plan_normalization import (  # noqa: F401 - compatibility re-exports
    _collapse_retries,
    _sync_index,
    empty_plan,
    normalize_plan,
    plan_from_cards,
    snapshot_cards,
)
from .round_plan_values import (  # noqa: F401 - re-exported for sibling rules
    _append_unique,
    _day,
    _find_occurrence,
    _int,
    _match_key,
    _original_card,
    _palace_id,
    _review_unit_id,
    _rewrite_ids,
    _text,
    _unique,
)

RETRY_GAP = 3
FAIL_RATINGS = {1, 2}
PASS_RATINGS = {3, 4}
OCCURRENCE_PENDING = "pending"
OCCURRENCE_INSERTED = "inserted"
OCCURRENCE_COMPLETED = "completed"
OCCURRENCE_CANCELLED = "cancelled"

Plan = dict[str, Any]


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
    # Score stays on the rated occurrence. Do not copy a 重练 glance onto the
    # source id — each occurrence keeps its own this-round score.

    if rating_value in PASS_RATINGS:
        if occ is not None:
            occ["rating"] = rating_value
            occ["encounter_id"] = encounter
        _settle_source(
            next_plan,
            source_id,
            keep_occurrence_id=_text(occ.get("occurrence_id")) if occ is not None else "",
        )
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
        # Next attempt is a blank glance: keep the occurrence, drop the score.
        left_occ["rating"] = None
        left_occ["encounter_id"] = ""
        next_plan["encounters"].pop(left_occ["occurrence_id"], None)
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
    """End this round's arrangement for the card, the same way a pass does.

    Does not write a 1–4 rating and does not touch ``completed_ids``. Pending
    retries of that source are cancelled so the round does not keep asking.
    """
    next_plan = normalize_plan(plan)
    target = _text(card_id)
    if not target:
        raise ValueError("card_id is required")
    source_id = _source_id_of(next_plan, target)
    _append_unique(next_plan["excluded_ids"], target)
    drop_ids: set[str] = set()
    for item in next_plan["occurrences"]:
        if _text(item.get("source_card_id")) != source_id:
            continue
        if item.get("status") not in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}:
            continue
        item["status"] = OCCURRENCE_CANCELLED
        occ_id = _text(item.get("occurrence_id"))
        if occ_id:
            drop_ids.add(occ_id)
    if drop_ids:
        next_plan["presented_ids"] = [
            item for item in next_plan["presented_ids"] if item not in drop_ids
        ]
    current = _text(next_plan.get("current_card_id"))
    if current == target or current in drop_ids:
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


def removed_review_palace_ids(plan: Mapping[str, Any] | None) -> set[int]:
    """Palaces the learner took out of this round via 移除本队列.

    A palace counts as removed only when **every** review card it had in this
    round is excluded. A palace with even one card still in the queue is still
    being reviewed, so its questions stay in 做题.

    Only ``excluded_ids`` counts. Completed cards do NOT remove a palace: the
    product decision is that a palace you have finished reviewing keeps its
    questions available for extra practice. Compressed (小结算) cards are also
    not removals — those were passed, then cleared from the feed.

    Used by 做题 scope: a palace whose cards were all removed must not
    contribute questions.
    """
    normalized = normalize_plan(plan)
    excluded = set(normalized["excluded_ids"])
    by_palace: dict[int, list[str]] = {}
    for card in normalized["original_cards"]:
        if card.get("kind") != "mindmap_branch":
            continue
        palace_id = card.get("palace_id")
        if not palace_id:
            continue
        by_palace.setdefault(int(palace_id), []).append(card["card_id"])
    return {
        palace_id
        for palace_id, card_ids in by_palace.items()
        if card_ids and all(card_id in excluded for card_id in card_ids)
    }


def review_unit_ids(plan: Mapping[str, Any] | None) -> list[str]:
    """Review-unit ids this round scheduled, in plan order (deduped).

    Quiz cards and retry occurrences are not units. Used to resolve questions'
    bound knowledge points to this round's own units, so a node owned elsewhere
    cannot borrow a rating.
    """
    normalized = normalize_plan(plan)
    ordered: list[str] = []
    seen: set[str] = set()
    for card in normalized["original_cards"]:
        if card.get("kind") != "mindmap_branch":
            continue
        unit_id = _text(card.get("unit_id"))
        if not unit_id or unit_id in seen:
            continue
        seen.add(unit_id)
        ordered.append(unit_id)
    return ordered


def waiting_review_unit_ids(plan: Mapping[str, Any] | None) -> list[str]:
    """Units the progress bar has not finished yet, in plan order.

    A card the bar already drew as done (completed, excluded, or compressed)
    is not waiting, even when it never received a 1–4 score. A live inserted
    retry of that card puts the unit back in the waiting set until the retry
    itself is done. Quiz cards have no unit.
    """
    normalized = normalize_plan(plan)
    unit_by_card: dict[str, str] = {}
    for card in normalized["original_cards"]:
        if card.get("kind") != "mindmap_branch":
            continue
        card_id = _text(card.get("card_id"))
        unit_id = _text(card.get("unit_id"))
        if card_id and unit_id:
            unit_by_card[card_id] = unit_id
    open_retry_sources: set[str] = set()
    for item in normalized["occurrences"]:
        if item.get("status") != OCCURRENCE_INSERTED:
            continue
        occ_id = _text(item.get("occurrence_id"))
        source_id = _text(item.get("source_card_id"))
        if not occ_id or not source_id or source_id not in unit_by_card:
            continue
        if _is_unfinished(normalized, occ_id):
            open_retry_sources.add(source_id)
    ordered: list[str] = []
    seen: set[str] = set()
    for card in normalized["original_cards"]:
        if card.get("kind") != "mindmap_branch":
            continue
        card_id = _text(card.get("card_id"))
        unit_id = _text(card.get("unit_id"))
        if not unit_id or unit_id in seen or not card_id:
            continue
        if _is_unfinished(normalized, card_id) or card_id in open_retry_sources:
            seen.add(unit_id)
            ordered.append(unit_id)
    return ordered


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


def _settle_source(
    plan: Plan,
    source_id: str,
    *,
    keep_occurrence_id: str = "",
) -> None:
    _append_unique(plan["completed_ids"], source_id)
    keep_id = _text(keep_occurrence_id)
    for item in plan["occurrences"]:
        if item["source_card_id"] != source_id:
            continue
        if item["status"] == OCCURRENCE_PENDING:
            item["status"] = OCCURRENCE_CANCELLED
        elif item["status"] == OCCURRENCE_INSERTED:
            # A pass on the source cancels an unanswered retry. If the learner
            # is currently answering that retry, keep its own answered glance
            # in the history and let the normal settlement mark it complete.
            own_encounter = plan["encounters"].get(item["occurrence_id"], {})
            if item["occurrence_id"] == keep_id or own_encounter.get("status") in {"passed", "failed"}:
                item["status"] = OCCURRENCE_COMPLETED
                _append_unique(plan["completed_ids"], item["occurrence_id"])
            else:
                item["status"] = OCCURRENCE_CANCELLED
                plan["presented_ids"] = [
                    card_id for card_id in plan["presented_ids"]
                    if card_id != item["occurrence_id"]
                ]
    _sync_index(plan)


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


def _is_unfinished(plan: Plan, card_id: str) -> bool:
    if not card_id or card_id in plan["completed_ids"] or card_id in plan["excluded_ids"] or card_id in plan["compressed_ids"]:
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


def _set_encounter(plan: Plan, card_id: str, encounter_id: str, revision: int, rating: int) -> None:
    target = _text(card_id)
    if not target:
        return
    plan["encounters"][target] = {
        "encounter_id": encounter_id,
        "status": "passed" if rating in PASS_RATINGS else "failed",
        "unit_revision": _int(revision),
        "rating": rating,
    }
