"""Pure domain tests for the backend-authoritative freestyle round plan."""

from __future__ import annotations

from memory_anki.modules.practice.domain.peer_progress import (
    apply_peer_progress,
    apply_peer_restore,
    progress_identity,
)
from memory_anki.modules.practice.domain.round_plan import (
    apply_rating,
    complete_card,
    exclude_card,
    insert_retry_after_gap,
    leave_card,
    next_unfinished_id,
    normalize_plan,
    occurrence_id_for,
    plan_from_cards,
    plan_is_fully_handled,
    set_cursor,
)
from memory_anki.modules.practice.domain.round_rebind import (
    append_today_cards,
    drop_vanished_unstarted,
    rebind_plan_cards,
    replan_remaining,
)
from memory_anki.modules.practice.domain.round_uncomplete import uncomplete_card

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
    live = [
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == "a" and item["status"] in {"pending", "inserted"}
    ]
    assert len(live) == 1
    assert live[0]["retry_attempt"] == 2
    assert live[0]["status"] == "inserted"
    assert live[0]["occurrence_id"] == inserted["occurrence_id"]
    plan = leave_card(plan, inserted["occurrence_id"])
    live = [
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == "a" and item["status"] in {"pending", "inserted"}
    ]
    assert len(live) == 1
    assert live[0]["retry_attempt"] == 3
    assert live[0]["occurrence_id"] == inserted["occurrence_id"]
    assert plan["presented_ids"].count(inserted["occurrence_id"]) == 1


def test_failing_a_retry_keeps_one_slot_and_leave_repositions_it():
    cards = [
        _card("a", unit_id="unit-a"),
        _card("b", unit_id="unit-b"),
        _card("c", unit_id="unit-c"),
        _card("d", unit_id="unit-d"),
        _card("e", unit_id="unit-e"),
        _card("f", unit_id="unit-f"),
    ]
    plan = leave_card(_rate(plan_from_cards(cards), "a", 1, "enc-1"), "a")
    retry_id = plan["occurrences"][0]["occurrence_id"]
    assert plan["presented_ids"] == ["a", "b", "c", "d", retry_id, "e", "f"]

    plan = set_cursor(plan, retry_id)
    plan = _rate(plan, retry_id, 1, "enc-2", occurrence_id=retry_id)
    live = [
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == "a" and item["status"] != "cancelled"
    ]
    assert len(live) == 1
    assert live[0]["retry_attempt"] == 1
    assert live[0]["occurrence_id"] == retry_id
    assert plan["presented_ids"].count(retry_id) == 1

    plan = leave_card(plan, retry_id)
    assert [item["status"] for item in plan["occurrences"] if item["source_card_id"] == "a"] == [
        "inserted"
    ]
    presented = plan["presented_ids"]
    assert presented.count(retry_id) == 1
    assert plan["occurrences"][0]["retry_attempt"] == 2
    assert presented == ["a", "b", "c", "d", "e", "f", retry_id]


def test_normalize_collapses_duplicate_live_retries():
    plan = plan_from_cards([_card("a", unit_id="unit-a"), _card("b"), _card("c")])
    plan = leave_card(_rate(plan, "a", 1, "enc-1"), "a")
    first = plan["occurrences"][0]
    duplicate = {
        **first,
        "occurrence_id": occurrence_id_for(ROUND_ID, "unit-a", 2),
        "retry_attempt": 2,
        "status": "inserted",
    }
    plan["occurrences"].append(duplicate)
    plan["presented_ids"].append(duplicate["occurrence_id"])

    collapsed = normalize_plan(plan)
    live = [
        item
        for item in collapsed["occurrences"]
        if item["source_card_id"] == "a" and item["status"] in {"pending", "inserted"}
    ]
    assert len(live) == 1
    assert collapsed["presented_ids"].count(live[0]["occurrence_id"]) == 1
    assert duplicate["occurrence_id"] not in collapsed["presented_ids"] or live[0]["occurrence_id"] == duplicate["occurrence_id"]


def test_same_encounter_amend_does_not_increment():
    plan = plan_from_cards([_card("a", unit_id="unit-a"), _card("b")])
    plan = _rate(plan, "a", 1, "enc-same")
    plan = _rate(plan, "a", 2, "enc-same")
    pending = [item for item in plan["occurrences"] if item["source_card_id"] == "a"]
    assert len(pending) == 1
    assert pending[0]["retry_attempt"] == 1
    assert pending[0]["rating"] == 2
    assert pending[0]["occurrence_id"] == occurrence_id_for(ROUND_ID, "unit-a", 1)


def test_fail_after_pass_removes_source_from_completed():
    plan = plan_from_cards([_card("a", unit_id="unit-a"), _card("b")])
    plan = _rate(plan, "a", 3, "enc-pass")
    assert "a" in plan["completed_ids"]
    plan = _rate(plan, "a", 1, "enc-fail")
    assert "a" not in plan["completed_ids"]
    pending = [item for item in plan["occurrences"] if item["source_card_id"] == "a"]
    assert pending
    assert pending[0]["rating"] == 1


def test_pass_settles_source_and_unfinished_occurrences():
    plan = plan_from_cards(
        [_card("a", unit_id="unit-a"), _card("b"), _card("c"), _card("d"), _card("e")]
    )
    plan = leave_card(_rate(plan, "a", 1, "enc-fail"), "a")
    inserted = [item for item in plan["occurrences"] if item["source_card_id"] == "a"][0]
    assert inserted["status"] == "inserted"
    plan = _rate(plan, inserted["occurrence_id"], 2, "enc-retry", occurrence_id=inserted["occurrence_id"])
    live = [
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == "a" and item["status"] in {"pending", "inserted"}
    ]
    assert len(live) == 1
    assert live[0]["occurrence_id"] == inserted["occurrence_id"]
    assert live[0]["retry_attempt"] == 1

    plan = _rate(plan, "a", 3, "enc-pass")
    assert "a" in plan["completed_ids"]
    by_status = {item["occurrence_id"]: item["status"] for item in plan["occurrences"]}
    assert by_status[inserted["occurrence_id"]] == "completed"
    assert inserted["occurrence_id"] in plan["completed_ids"]
    assert "pending" not in by_status.values()
    left = leave_card(plan, "a")
    assert left["presented_ids"] == plan["presented_ids"]


def test_passing_a_retry_keeps_that_occurrence_in_presented_ids():
    cards = [
        _card("a", unit_id="unit-a"),
        _card("b", unit_id="unit-b"),
        _card("c", unit_id="unit-c"),
        _card("d", unit_id="unit-d"),
        _card("e", unit_id="unit-e"),
    ]
    plan = leave_card(_rate(plan_from_cards(cards), "a", 1, "enc-fail"), "a")
    inserted = [item for item in plan["occurrences"] if item["source_card_id"] == "a"][0]
    plan = set_cursor(plan, inserted["occurrence_id"])
    plan = _rate(
        plan,
        inserted["occurrence_id"],
        3,
        "enc-pass",
        occurrence_id=inserted["occurrence_id"],
    )
    assert inserted["occurrence_id"] in plan["presented_ids"]
    assert inserted["occurrence_id"] in plan["completed_ids"]
    assert plan["current_card_id"] == inserted["occurrence_id"]
    rebound = rebind_plan_cards(plan, cards)
    assert inserted["occurrence_id"] in rebound["presented_ids"]
    assert rebound["current_card_id"] == inserted["occurrence_id"]


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


def test_rebind_reorders_unstarted_and_keeps_completed():
    original = [
        _card("a1", palace_id=1),
        _card("a2", palace_id=1),
        _card("b1", palace_id=2),
        _card("b2", palace_id=2),
    ]
    plan = complete_card(plan_from_cards(original), "a1")
    rebound = rebind_plan_cards(
        plan,
        [
            _card("a1", palace_id=1),
            _card("b1", palace_id=2),
            _card("a2", palace_id=1),
            _card("b2", palace_id=2),
        ],
        reorder_unstarted=True,
    )
    assert rebound["presented_ids"] == ["a1", "b1", "a2", "b2"]
    assert rebound["completed_ids"] == ["a1"]

    kept = rebind_plan_cards(
        plan,
        [
            _card("b2", palace_id=2),
            _card("b1", palace_id=2),
            _card("a2", palace_id=1),
            _card("a1", palace_id=1),
        ],
        reorder_unstarted=False,
    )
    assert kept["presented_ids"] == ["a1", "a2", "b1", "b2"]


def test_rebind_drop_missing_unstarted_keeps_order_and_completed():
    original = [
        _card("a"),
        _card("b"),
        _card("c"),
        _card("extra"),
    ]
    plan = complete_card(plan_from_cards(original), "a")
    rebound = rebind_plan_cards(
        plan,
        [_card("c"), _card("b"), _card("d")],
        drop_missing_unstarted=True,
    )
    original_ids = [item["card_id"] for item in rebound["original_cards"]]
    assert rebound["completed_ids"] == ["a"]
    assert "a" in original_ids
    assert "b" in original_ids
    assert "c" in original_ids
    assert "d" in original_ids
    assert "extra" not in original_ids
    assert rebound["presented_ids"] == ["a", "c", "b", "d"]


def test_uncomplete_card_clears_a_cancelled_rating():
    plan = complete_card(plan_from_cards([_card("a"), _card("b")]), "a")
    assert plan["completed_ids"] == ["a"]
    cleared = uncomplete_card(plan, "a")
    assert "a" not in cleared["completed_ids"]
    assert cleared["presented_ids"] == ["a", "b"]


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


def test_rebind_reattaches_retries_when_source_card_was_dropped():
    original = [
        _card("review_unit:u1:r1", unit_id="u1", revision=1),
        _card("b", unit_id="unit-b"),
    ]
    plan = leave_card(_rate(plan_from_cards(original), "review_unit:u1:r1", 1, "enc-1"), "review_unit:u1:r1")
    plan["original_cards"] = [item for item in plan["original_cards"] if item["card_id"] != "review_unit:u1:r1"]
    plan["presented_ids"] = [item for item in plan["presented_ids"] if item != "review_unit:u1:r1"]
    rebound = rebind_plan_cards(
        plan,
        [_card("review_unit:u1:r2", unit_id="u1", revision=2), _card("b", unit_id="unit-b")],
    )
    assert rebound["occurrences"][0]["source_card_id"] == "review_unit:u1:r2"
    assert rebound["occurrences"][0]["retry_attempt"] == 1
    assert "review_unit:u1:r2" in rebound["presented_ids"]


def test_rebind_does_not_complete_unstarted_when_incoming_has_retries():
    cards = [
        _card("review_unit:a:r1", unit_id="a"),
        _card("review_unit:b:r1", unit_id="b"),
        _card("review_unit:c:r1", unit_id="c"),
    ]
    plan = leave_card(_rate(plan_from_cards(cards), "review_unit:a:r1", 1, "enc-a"), "review_unit:a:r1")
    retry_id = plan["occurrences"][0]["occurrence_id"]
    rebound = rebind_plan_cards(
        plan,
        [
            {
                "id": retry_id,
                "unit_id": "a",
                "kind": "mindmap_branch",
                "palace_id": 1,
                "occurrence_kind": "retry",
                "source_card_id": "review_unit:a:r1",
            },
            _card("review_unit:b:r1", unit_id="b"),
            _card("review_unit:c:r1", unit_id="c"),
            _card("review_unit:a:r1", unit_id="a"),
        ],
    )
    original_ids = [item["card_id"] for item in rebound["original_cards"]]
    assert retry_id not in original_ids
    assert "review_unit:b:r1" in original_ids
    assert "review_unit:c:r1" in original_ids
    assert "review_unit:b:r1" not in rebound["completed_ids"]
    assert "review_unit:c:r1" not in rebound["completed_ids"]
    assert rebound["occurrences"][0]["source_card_id"] == "review_unit:a:r1"
    assert next_unfinished_id(rebound, after_id="review_unit:a:r1") in {
        "review_unit:b:r1",
        "review_unit:c:r1",
        retry_id,
    }


def test_silent_rebind_keeps_unstarted_originals_missing_from_incoming():
    cards = [
        _card("a", unit_id="unit-a"),
        _card("b", unit_id="unit-b"),
        _card("c", unit_id="unit-c"),
    ]
    plan = _rate(plan_from_cards(cards), "a", 3, "enc-pass")
    rebound = rebind_plan_cards(plan, [_card("a", unit_id="unit-a")])
    original_ids = [item["card_id"] for item in rebound["original_cards"]]
    assert "b" in original_ids
    assert "c" in original_ids
    assert rebound["completed_ids"] == ["a"]
    assert next_unfinished_id(rebound) in {"b", "c"}


def test_rebind_after_fail_keeps_current_on_source():
    cards = [
        _card("a", unit_id="unit-a"),
        _card("b", unit_id="unit-b"),
        _card("c", unit_id="unit-c"),
    ]
    plan = _rate(plan_from_cards(cards), "a", 1, "enc-fail")
    rebound = rebind_plan_cards(plan, cards)
    assert rebound["current_card_id"] == "a"
    assert _pending(rebound, "a")["status"] == "pending"


def test_rebind_keeps_failed_sources_missing_from_new_due_list():
    cards = [_card(f"u{index}", unit_id=f"unit-{index}") for index in range(1, 6)]
    plan = plan_from_cards(cards)
    for index, card_id in enumerate(["u1", "u2", "u3"], start=1):
        plan = leave_card(_rate(plan, card_id, 1, f"enc-{index}"), card_id)

    rebound = rebind_plan_cards(
        plan,
        [
            _card("u4", unit_id="unit-4"),
            _card("u5", unit_id="unit-5"),
            _card("u6", unit_id="unit-6"),
        ],
    )
    original_ids = [item["card_id"] for item in rebound["original_cards"]]
    for card_id in ("u1", "u2", "u3", "u4", "u6"):
        assert card_id in original_ids

    presented = rebound["presented_ids"]
    retry_ids = [
        item["occurrence_id"]
        for item in rebound["occurrences"]
        if item["status"] == "inserted"
    ]
    assert len(retry_ids) == 3
    assert presented[0] not in retry_ids
    for occ in rebound["occurrences"]:
        if occ["status"] != "inserted":
            continue
        source = occ["source_card_id"]
        assert source in presented
        assert occ["occurrence_id"] in presented
        assert presented.index(source) < presented.index(occ["occurrence_id"])


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


def test_retry_stays_in_leftover_when_today_cards_append():
    yesterday = "2026-09-17"
    today = "2026-09-18"
    plan = plan_from_cards([_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b")], today=yesterday)
    plan = leave_card(_rate(plan, "a", 2, "enc-a"), "a")
    retry_a = plan["occurrences"][0]["occurrence_id"]
    assert plan["presented_ids"] == ["a", "b", retry_a]

    rebound = append_today_cards(
        plan,
        [_card(f"c{index}", unit_id=f"unit-c{index}") for index in range(1, 11)],
        today=today,
    )
    presented = rebound["presented_ids"]
    assert presented[:3] == ["a", "b", retry_a]
    assert presented[3:] == [f"c{index}" for index in range(1, 11)]
    entered = {item["card_id"]: item["entered_on"] for item in rebound["original_cards"]}
    assert entered["a"] == yesterday
    assert entered["b"] == yesterday
    assert entered["c1"] == today
    assert entered["c10"] == today


def test_retry_insert_does_not_borrow_today_segment():
    yesterday = "2026-09-17"
    today = "2026-09-18"
    plan = plan_from_cards([_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b")], today=yesterday)
    plan = append_today_cards(
        plan,
        [
            _card("a", unit_id="unit-a"),
            _card("b", unit_id="unit-b"),
            _card("c1", unit_id="unit-c1"),
            _card("c2", unit_id="unit-c2"),
            _card("c3", unit_id="unit-c3"),
        ],
        today=today,
    )
    plan = leave_card(_rate(plan, "a", 2, "enc-a"), "a")
    retry_a = plan["occurrences"][0]["occurrence_id"]
    assert plan["presented_ids"][:3] == ["a", "b", retry_a]
    assert plan["presented_ids"][3:] == ["c1", "c2", "c3"]


def test_replan_remaining_parks_retries_near_new_queue_start():
    yesterday = "2026-09-17"
    today = "2026-09-18"
    plan = plan_from_cards(
        [_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b"), _card("c", unit_id="unit-c")],
        today=yesterday,
    )
    plan = complete_card(plan, "b")
    plan = leave_card(_rate(plan, "a", 1, "enc-a"), "a")
    retry_a = plan["occurrences"][0]["occurrence_id"]
    rebound = replan_remaining(
        plan,
        [
            _card("n1", unit_id="unit-n1"),
            _card("n2", unit_id="unit-n2"),
            _card("n3", unit_id="unit-n3"),
            _card("n4", unit_id="unit-n4"),
        ],
        today=today,
    )
    presented = rebound["presented_ids"]
    assert presented == ["a", "b", "n1", "n2", "n3", retry_a, "n4"]
    assert "c" not in [item["card_id"] for item in rebound["original_cards"]]


def test_multi_day_append_keeps_two_cohorts():
    today = "2026-09-18"
    plan = plan_from_cards([_card("a"), _card("b")], today="2026-09-16")
    plan = append_today_cards(plan, [_card("a"), _card("b"), _card("c")], today="2026-09-17")
    plan = append_today_cards(
        plan,
        [_card("a"), _card("b"), _card("c"), _card("d")],
        today=today,
    )
    carried = [item["card_id"] for item in plan["original_cards"] if item["entered_on"] < today]
    new = [item["card_id"] for item in plan["original_cards"] if item["entered_on"] == today]
    assert carried == ["a", "b", "c"]
    assert new == ["d"]
    assert plan["presented_ids"] == ["a", "b", "c", "d"]


def test_progress_identity_ignores_revision_and_maps_quiz_cards():
    unit = _card("review_unit:u1:r2", unit_id="u1", revision=2)
    quiz = _card("quiz_question:9", kind="quiz_question")
    assert progress_identity(unit) == "unit:u1"
    assert progress_identity(quiz) == "quiz:9"


def test_peer_progress_completes_overlapping_unit_without_moving_cursor():
    primary = complete_card(
        plan_from_cards([_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b")]),
        "a",
    )
    secondary = set_cursor(
        plan_from_cards(
            [
                _card("review_unit:unit-a:r1", unit_id="unit-a"),
                _card("review_unit:unit-c:r1", unit_id="unit-c"),
            ]
        ),
        "review_unit:unit-a:r1",
    )
    synced = apply_peer_progress(secondary, primary, round_id="round-b", preserve_cursor=True)
    assert "review_unit:unit-a:r1" in synced["completed_ids"]
    assert synced["current_card_id"] == "review_unit:unit-a:r1"
    assert "review_unit:unit-c:r1" not in synced["completed_ids"]


def test_peer_progress_excludes_and_copies_retry():
    cards = [_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b"), _card("c", unit_id="unit-c")]
    failed = leave_card(_rate(plan_from_cards(cards), "a", 1, "enc-a"), "a")
    excluded = exclude_card(plan_from_cards(cards), "b")
    peer = apply_peer_progress(failed, excluded, round_id="round-a")
    target = plan_from_cards(
        [
            _card("x", unit_id="unit-a"),
            _card("y", unit_id="unit-b"),
            _card("z", unit_id="unit-other"),
        ]
    )
    synced = apply_peer_progress(target, peer, round_id="round-b", preserve_cursor=False)
    assert "x" not in synced["completed_ids"]
    assert "y" in synced["excluded_ids"]
    assert "z" not in synced["excluded_ids"]
    retries = [item for item in synced["occurrences"] if item["source_card_id"] == "x"]
    assert retries
    assert retries[0]["status"] == "inserted"
    assert synced["current_card_id"] != "y"


def test_peer_progress_quiz_overlap_and_restore():
    primary = complete_card(plan_from_cards([_card("quiz_question:9", kind="quiz_question")]), "quiz_question:9")
    secondary = plan_from_cards(
        [_card("quiz_question:9", kind="quiz_question"), _card("quiz_question:10", kind="quiz_question")]
    )
    synced = apply_peer_progress(secondary, primary, preserve_cursor=False)
    assert "quiz_question:9" in synced["completed_ids"]
    assert "quiz_question:10" not in synced["completed_ids"]

    excluded = exclude_card(secondary, "quiz_question:10")
    restored = apply_peer_restore(excluded, "quiz:10")
    assert "quiz_question:10" not in restored["excluded_ids"]


def test_new_round_skips_peer_completed_as_current():
    peer = complete_card(plan_from_cards([_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b")]), "a")
    fresh = plan_from_cards(
        [_card("review_unit:unit-a:r3", unit_id="unit-a"), _card("review_unit:unit-b:r1", unit_id="unit-b")]
    )
    seeded = apply_peer_progress(fresh, peer, preserve_cursor=False)
    assert seeded["current_card_id"] == "review_unit:unit-b:r1"


def test_rating_rejects_retry_card_without_occurrence_id():
    cards = [
        _card("a", unit_id="unit-a"),
        _card("b", unit_id="unit-b"),
        _card("c", unit_id="unit-c"),
        _card("d", unit_id="unit-d"),
        _card("e", unit_id="unit-e"),
    ]
    plan = leave_card(_rate(plan_from_cards(cards), "a", 1, "enc-fail"), "a")
    retry_id = plan["occurrences"][0]["occurrence_id"]
    try:
        _rate(plan, retry_id, 3, "enc-pass")
    except ValueError as error:
        assert "identity" in str(error)
    else:
        raise AssertionError("expected rating identity mismatch")


def test_rating_rejects_occurrence_from_another_unit():
    cards = [
        _card("a", unit_id="unit-a"),
        _card("b", unit_id="unit-b"),
        _card("c", unit_id="unit-c"),
        _card("d", unit_id="unit-d"),
        _card("e", unit_id="unit-e"),
    ]
    plan = leave_card(_rate(plan_from_cards(cards), "a", 1, "enc-fail"), "a")
    retry_id = plan["occurrences"][0]["occurrence_id"]
    try:
        _rate(plan, retry_id, 3, "enc-pass", occurrence_id=retry_id, unit_id="unit-b")
    except ValueError as error:
        assert "identity" in str(error)
    else:
        raise AssertionError("expected rating identity mismatch")


def test_rating_rejects_card_id_that_does_not_match_occurrence():
    cards = [
        _card("a", unit_id="unit-a"),
        _card("b", unit_id="unit-b"),
        _card("c", unit_id="unit-c"),
        _card("d", unit_id="unit-d"),
        _card("e", unit_id="unit-e"),
    ]
    plan = leave_card(_rate(plan_from_cards(cards), "a", 1, "enc-fail"), "a")
    retry_id = plan["occurrences"][0]["occurrence_id"]
    try:
        _rate(plan, "b", 3, "enc-pass", occurrence_id=retry_id, unit_id="unit-a")
    except ValueError as error:
        assert "identity" in str(error)
    else:
        raise AssertionError("expected rating identity mismatch")


def test_plan_is_fully_handled_after_every_source_passes():
    plan = _rate(plan_from_cards([_card("a", unit_id="unit-a")]), "a", 3, "enc-pass")
    assert plan_is_fully_handled(plan) is True
    unfinished = plan_from_cards([_card("a", unit_id="unit-a"), _card("b", unit_id="unit-b")])
    assert plan_is_fully_handled(unfinished) is False


def test_last_card_forget_or_hard_stays_unfinished_until_retry_follows_source():
    ids = ["c1", "c2", "c3", "c4", "source"]
    cards = [_card(card_id, unit_id=f"unit-{card_id}") for card_id in ids]
    for rating, encounter in ((1, "enc-forget"), (2, "enc-hard")):
        plan = plan_from_cards(cards, today="2026-09-22")
        for card_id in ids[:-1]:
            plan = _rate(plan, card_id, 3, f"pass-{card_id}-{encounter}")
        plan = _rate(plan, "source", rating, encounter)
        assert plan["presented_ids"] == ids
        assert plan["occurrences"][0]["status"] == "pending"
        assert "source" not in plan["completed_ids"]
        assert plan_is_fully_handled(plan) is False
        assert next_unfinished_id(plan) == "source"
        left = leave_card(plan, "source")
        retry_id = left["occurrences"][0]["occurrence_id"]
        assert left["occurrences"][0]["status"] == "inserted"
        assert left["presented_ids"] == [*ids, retry_id]
        assert plan_is_fully_handled(left) is False
        assert next_unfinished_id(left) == retry_id


def test_retry_parked_before_source_moves_behind_source_on_leave_and_append():
    ids = ["c1", "c2", "c3", "c4", "source"]
    cards = [_card(card_id, unit_id=f"unit-{card_id}") for card_id in ids]
    plan = _rate(plan_from_cards(cards, today="2026-09-22"), "source", 2, "enc-hard")
    occ = plan["occurrences"][0]
    retry_id = occ["occurrence_id"]
    parked = dict(plan)
    parked["occurrences"] = [dict(occ, status="inserted", entered_on="", insert_target_index=0)]
    parked["presented_ids"] = [retry_id, *ids]
    parked["current_card_id"] = "source"

    left = leave_card(parked, "source")
    assert left["presented_ids"] == [*ids, retry_id]
    assert left["occurrences"][0]["status"] == "inserted"
    assert left["occurrences"][0]["entered_on"] == "2026-09-22"
    assert left["current_card_id"] == "source"

    appended = append_today_cards(parked, cards, today="2026-09-22")
    assert appended["presented_ids"] == [*ids, retry_id]

    healthy = leave_card(
        _rate(plan_from_cards(cards, today="2026-09-22"), "source", 1, "enc-forget"),
        "source",
    )
    healthy_retry = healthy["occurrences"][0]["occurrence_id"]
    assert leave_card(healthy, "c1")["presented_ids"] == [*ids, healthy_retry]


def test_drop_vanished_unstarted_keeps_live_quiz_and_completed():
    cards = [
        _card("gone", unit_id="missing"),
        _card("live", unit_id="live"),
        _card("quiz", kind="quiz_question"),
        _card("done", unit_id="also-missing"),
    ]
    plan = complete_card(plan_from_cards(cards), "done")
    plan["current_card_id"] = "gone"
    dropped = drop_vanished_unstarted(plan, {"live"})
    assert [item["card_id"] for item in dropped["original_cards"]] == ["live", "quiz", "done"]
    assert "gone" not in dropped["presented_ids"]
    assert dropped["completed_ids"] == ["done"]
    assert dropped["current_card_id"] == "live"


def test_drop_vanished_unstarted_keeps_retry_source_and_drops_the_other():
    cards = [
        _card("weak", unit_id="gone-unit"),
        _card("other", unit_id="also-gone"),
    ]
    plan = leave_card(_rate(plan_from_cards(cards), "weak", 2, "enc-weak"), "weak")
    dropped = drop_vanished_unstarted(plan, set())
    assert [item["card_id"] for item in dropped["original_cards"]] == ["weak"]
    assert dropped["occurrences"][0]["source_card_id"] == "weak"
    assert dropped["occurrences"][0]["occurrence_id"] in dropped["presented_ids"]
    assert "other" not in dropped["presented_ids"]


def test_append_after_drop_does_not_resurrect_ghost_and_keeps_leftover():
    plan = plan_from_cards(
        [
            _card("ghost", unit_id="ghost"),
            _card("leftover", unit_id="leftover"),
        ],
        today="2026-09-21",
    )
    dropped = drop_vanished_unstarted(plan, {"leftover"})
    appended = append_today_cards(
        dropped,
        [
            _card("leftover", unit_id="leftover"),
            _card("today", unit_id="today-unit"),
        ],
        today="2026-09-22",
    )
    ids = [item["card_id"] for item in appended["original_cards"]]
    assert "ghost" not in ids
    assert "leftover" in ids
    assert "today" in ids
    assert appended["presented_ids"][:2] == ["leftover", "today"]
