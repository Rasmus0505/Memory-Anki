"""Pure domain tests for the backend-authoritative freestyle round plan."""

from __future__ import annotations

from memory_anki.modules.practice.domain.round_plan import (
    apply_rating,
    complete_card,
    insert_retry_after_gap,
    leave_card,
    next_unfinished_id,
    occurrence_id_for,
    plan_from_cards,
    rebind_plan_cards,
    set_cursor,
)

ROUND_ID = "round-1"


def _card(
    card_id: str,
    *,
    kind: str = "mindmap_branch",
    unit_id: str = "",
    revision: int = 1,
    palace_id: int = 1,
) -> dict:
    payload = {
        "id": card_id,
        "type": kind,
        "kind": kind,
        "unit_revision": revision,
        "palace_id": palace_id,
        "palace_title": "Palace",
        "label": card_id,
    }
    if unit_id:
        payload["unit_id"] = unit_id
    return payload


def _rate(plan, card_id: str, rating: int, encounter_id: str, **kwargs):
    return apply_rating(
        plan,
        card_id=card_id,
        rating=rating,
        encounter_id=encounter_id,
        round_id=ROUND_ID,
        **kwargs,
    )


def _pending(plan, source_card_id: str) -> dict:
    matches = [
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == source_card_id and item["status"] == "pending"
    ]
    assert matches, f"expected pending occurrence for {source_card_id}"
    return matches[-1]


def test_forget_and_hard_both_create_pending_occurrence():
    cards = [_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b")]
    forgotten = _rate(plan_from_cards(cards), "a", 1, "enc-forget")
    hard = _rate(plan_from_cards(cards), "a", 2, "enc-hard")

    forget_occ = _pending(forgotten, "a")
    hard_occ = _pending(hard, "a")
    assert forget_occ["retry_attempt"] == 1
    assert hard_occ["retry_attempt"] == 1
    assert forget_occ["rating"] == 1
    assert hard_occ["rating"] == 2
    assert forget_occ["occurrence_id"] == occurrence_id_for(ROUND_ID, "unit-a", 1)
    assert hard_occ["occurrence_id"] == occurrence_id_for(ROUND_ID, "unit-a", 1)
    assert forgotten["presented_ids"] == ["a", "b"]
    assert hard["presented_ids"] == ["a", "b"]


def test_leave_inserts_after_exactly_three_presented_cards_including_quiz_and_retries():
    cards = [
        _card("x", unit_id="unit-x"),
        _card("y", unit_id="unit-y"),
        _card("z", unit_id="unit-z"),
        _card("a", unit_id="unit-a"),
        _card("quiz-1", kind="quiz_question"),
        _card("b", unit_id="unit-b"),
    ]
    plan = plan_from_cards(cards)
    plan = leave_card(_rate(plan, "x", 1, "enc-x"), "x")
    retry_x = [item["occurrence_id"] for item in plan["occurrences"] if item["source_card_id"] == "x"][0]
    assert plan["presented_ids"] == ["x", "y", "z", "a", retry_x, "quiz-1", "b"]

    plan = leave_card(_rate(plan, "a", 2, "enc-a"), "a")
    retry_a = [item["occurrence_id"] for item in plan["occurrences"] if item["source_card_id"] == "a"][0]
    presented = plan["presented_ids"]
    gap = presented[presented.index("a") + 1 : presented.index(retry_a)]
    assert gap == [retry_x, "quiz-1", "b"]
    assert retry_x in gap
    assert "quiz-1" in gap


def test_not_enough_cards_appends_retry_to_end():
    plan = plan_from_cards([_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b")])
    plan = leave_card(_rate(plan, "a", 1, "enc-a"), "a")
    retry_a = plan["occurrences"][0]["occurrence_id"]
    assert plan["presented_ids"] == ["a", "b", retry_a]
    assert plan["occurrences"][0]["status"] == "inserted"
    assert plan["occurrences"][0]["insert_target_index"] == 2


def test_consecutive_failures_increment_retry_attempt():
    plan = plan_from_cards(
        [_card("a", unit_id="unit-a"), _card("b"), _card("c"), _card("d"), _card("e")]
    )
    plan = _rate(plan, "a", 1, "enc-1")
    assert _pending(plan, "a")["retry_attempt"] == 1
    plan = _rate(plan, "a", 1, "enc-2")
    pending = _pending(plan, "a")
    assert pending["retry_attempt"] == 2
    assert pending["occurrence_id"] == occurrence_id_for(ROUND_ID, "unit-a", 2)
    assert [item["status"] for item in plan["occurrences"] if item["source_card_id"] == "a"] == [
        "pending"
    ]

    plan = leave_card(plan, "a")
    inserted = [item for item in plan["occurrences"] if item["source_card_id"] == "a"][0]
    plan = _rate(plan, inserted["occurrence_id"], 2, "enc-3", occurrence_id=inserted["occurrence_id"])
    next_pending = _pending(plan, "a")
    assert next_pending["retry_attempt"] == 3
    assert next_pending["status"] == "pending"
    assert inserted["occurrence_id"] != next_pending["occurrence_id"]


def test_same_encounter_amend_does_not_increment():
    plan = plan_from_cards([_card("a", unit_id="unit-a"), _card("b")])
    plan = _rate(plan, "a", 1, "enc-same")
    plan = _rate(plan, "a", 2, "enc-same")
    pending = [item for item in plan["occurrences"] if item["source_card_id"] == "a"]
    assert len(pending) == 1
    assert pending[0]["retry_attempt"] == 1
    assert pending[0]["rating"] == 2
    assert pending[0]["occurrence_id"] == occurrence_id_for(ROUND_ID, "unit-a", 1)


def test_pass_settles_source_and_unfinished_occurrences():
    plan = plan_from_cards(
        [_card("a", unit_id="unit-a"), _card("b"), _card("c"), _card("d"), _card("e")]
    )
    plan = leave_card(_rate(plan, "a", 1, "enc-fail"), "a")
    inserted = [item for item in plan["occurrences"] if item["source_card_id"] == "a"][0]
    assert inserted["status"] == "inserted"
    plan = _rate(plan, inserted["occurrence_id"], 2, "enc-retry", occurrence_id=inserted["occurrence_id"])
    assert _pending(plan, "a")["status"] == "pending"

    plan = _rate(plan, "a", 3, "enc-pass")
    assert "a" in plan["completed_ids"]
    by_status = {item["occurrence_id"]: item["status"] for item in plan["occurrences"]}
    assert by_status[inserted["occurrence_id"]] == "completed"
    assert inserted["occurrence_id"] in plan["completed_ids"]
    assert "pending" not in by_status.values()
    assert "cancelled" in by_status.values()
    left = leave_card(plan, "a")
    assert left["presented_ids"] == plan["presented_ids"]


def test_rebind_by_unit_id_keeps_ratings_and_retry_counts():
    original = [
        _card("review_unit:u1:r1", unit_id="u1", revision=1),
        _card("quiz_question:9", kind="quiz_question"),
        _card("review_unit:u2:r1", unit_id="u2", revision=1),
    ]
    plan = leave_card(_rate(plan_from_cards(original), "review_unit:u1:r1", 1, "enc-1"), "review_unit:u1:r1")
    occ = plan["occurrences"][0]
    rebound = rebind_plan_cards(
        plan,
        [
            _card("review_unit:u1:r2", unit_id="u1", revision=2),
            _card("quiz_question:9", kind="quiz_question"),
            _card("review_unit:u2:r1", unit_id="u2", revision=1),
        ],
    )
    assert rebound["original_cards"][0]["card_id"] == "review_unit:u1:r2"
    assert rebound["original_cards"][0]["unit_revision"] == 2
    assert rebound["original_cards"][1]["card_id"] == "quiz_question:9"
    assert rebound["occurrences"][0]["retry_attempt"] == occ["retry_attempt"] == 1
    assert rebound["occurrences"][0]["rating"] == 1
    assert rebound["occurrences"][0]["source_card_id"] == "review_unit:u1:r2"
    assert rebound["occurrences"][0]["occurrence_id"] == occ["occurrence_id"]
    assert "review_unit:u1:r2" in rebound["presented_ids"]
    assert occ["occurrence_id"] in rebound["presented_ids"]


def test_rebind_completed_unit_keeps_parent_rating():
    original = [_card("review_unit:u1:r1", unit_id="u1", revision=1)]
    plan = leave_card(_rate(plan_from_cards(original), "review_unit:u1:r1", 3, "enc-pass"), "review_unit:u1:r1")
    rebound = rebind_plan_cards(
        plan,
        [_card("review_unit:u1:r2", unit_id="u1", revision=2)],
    )
    assert rebound["completed_ids"] == ["review_unit:u1:r2"]
    assert next_unfinished_id(rebound) is None


def test_history_lookback_does_not_move_cursor_or_insert():
    plan = plan_from_cards([_card("a", unit_id="unit-a"), _card("b"), _card("c"), _card("d")])
    plan = _rate(plan, "a", 1, "enc-a")
    looked = set_cursor(plan, "c", commit=False)
    assert looked["current_card_id"] == "a"
    assert looked["current_index"] == 0
    assert looked["presented_ids"] == ["a", "b", "c", "d"]
    assert looked["occurrences"][0]["status"] == "pending"
    committed = set_cursor(plan, "c", commit=True)
    assert committed["current_card_id"] == "c"
    assert committed["occurrences"][0]["status"] == "pending"
    assert committed["presented_ids"] == ["a", "b", "c", "d"]


def test_current_missing_or_completed_picks_next_unfinished():
    cards = [
        _card("a", unit_id="unit-a"),
        _card("b", unit_id="unit-b"),
        _card("c", unit_id="unit-c"),
    ]
    plan = _rate(plan_from_cards(cards), "a", 3, "enc-pass")
    assert plan["current_card_id"] == "a"
    assert next_unfinished_id(plan) == "b"
    rebound = rebind_plan_cards(plan, cards)
    assert rebound["current_card_id"] == "b"

    missing = dict(rebound)
    missing["current_card_id"] = "gone"
    repaired = rebind_plan_cards(missing, cards)
    assert repaired["current_card_id"] == "b"

    completed = complete_card(plan_from_cards(cards), "a")
    assert completed["current_card_id"] == "b"


def test_insert_retry_after_gap_uses_all_presented_ids():
    plan = plan_from_cards(
        [_card("a"), _card("quiz", kind="quiz_question"), _card("b"), _card("c"), _card("d")]
    )
    plan = _rate(plan, "a", 1, "enc-a")
    occ_id = plan["occurrences"][0]["occurrence_id"]
    inserted = insert_retry_after_gap(plan, occ_id, 0)
    assert inserted["presented_ids"][4] == occ_id
    assert inserted["presented_ids"][:4] == ["a", "quiz", "b", "c"]
