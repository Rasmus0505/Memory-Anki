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
    assert rebound["presented_ids"] == ["a", "b", "c", "d"]


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
