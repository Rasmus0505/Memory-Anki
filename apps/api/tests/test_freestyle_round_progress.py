"""The round payload's progress projection must agree with the plan rules."""

from __future__ import annotations

import json
from datetime import datetime

from memory_anki.modules.practice.domain.round_compress import compressible_ids
from memory_anki.modules.practice.domain.round_plan import (
    apply_rating,
    leave_card,
    next_unfinished_id,
    plan_from_cards,
    plan_is_fully_handled,
)
from memory_anki.modules.practice.domain.round_plan_intraday import plan_waiting
from memory_anki.modules.practice.domain.round_progress import project_round_progress

ROUND_ID = "round-1"


def _card(card_id: str, *, unit_id: str = "", palace_id: int = 1) -> dict:
    return {
        "id": card_id,
        "type": "mindmap_branch",
        "kind": "mindmap_branch",
        "unit_revision": 1,
        "palace_id": palace_id,
        "palace_title": "宫殿",
        "label": card_id,
        "unit_id": unit_id or f"unit-{card_id}",
    }


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
    return next(
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == source_card_id and item["status"] == "pending"
    )


def _inserted(plan, source_card_id: str) -> dict:
    return next(
        item
        for item in plan["occurrences"]
        if item["source_card_id"] == source_card_id and item["status"] == "inserted"
    )


def test_progress_items_follow_presented_order_and_start_at_the_first_card():
    plan = plan_from_cards([_card("a"), _card("b")])

    progress = project_round_progress(plan)

    assert [item["card_id"] for item in progress["items"]] == plan["presented_ids"]
    assert progress["total"] == 2
    assert progress["scheduled_base"] == 2
    assert progress["current_card_id"] == "a"
    assert progress["position"] == 1
    assert progress["done_count"] == 0
    assert progress["next_unfinished_id"] == "a"
    assert progress["fully_handled"] is False


def test_progress_agrees_with_the_plan_helpers_on_every_read():
    forgotten = _rate(plan_from_cards([_card("a"), _card("b")]), "a", 1, "enc-1")
    passed = _rate(plan_from_cards([_card("a"), _card("b")]), "a", 3, "enc-2")
    left = leave_card(passed, "a")

    for plan in (plan_from_cards([_card("a")]), forgotten, passed, left):
        progress = project_round_progress(plan)
        assert progress["next_unfinished_id"] == next_unfinished_id(plan)
        assert progress["fully_handled"] == plan_is_fully_handled(plan)
        assert progress["compressible_ids"] == compressible_ids(plan)
        assert progress["waiting"]["count"] == plan_waiting(plan)["count"]


def test_progress_is_a_pure_projection_and_does_not_mutate_the_plan():
    plan = _rate(plan_from_cards([_card("a"), _card("b")]), "a", 1, "enc-1")
    before = json.dumps(plan, sort_keys=True, ensure_ascii=False)

    first = project_round_progress(plan)
    second = project_round_progress(plan)

    assert json.dumps(plan, sort_keys=True, ensure_ascii=False) == before
    assert first == second


def test_rating_a_card_keeps_the_position_on_that_card_until_leave():
    plan = _rate(plan_from_cards([_card("a"), _card("b")]), "a", 3, "enc-1")

    progress = project_round_progress(plan)

    assert progress["current_card_id"] == "a"
    assert progress["position"] == 1
    assert progress["next_unfinished_id"] == "b"
    assert {item["card_id"]: item["status"] for item in progress["items"]} == {
        "a": "done",
        "b": "pending",
    }


def test_a_retry_only_carries_a_score_from_its_own_encounter():
    plan = _rate(plan_from_cards([_card("a")]), "a", 1, "enc-parent")
    inserted = _inserted(plan, "a")
    before = project_round_progress(plan)
    retry_before = next(
        item for item in before["items"] if item["card_id"] == inserted["occurrence_id"]
    )
    assert retry_before["scored"] is False
    assert retry_before["own_rating"] is None

    rated = _rate(
        plan,
        inserted["occurrence_id"],
        3,
        "enc-retry",
        occurrence_id=inserted["occurrence_id"],
    )
    after = project_round_progress(rated)
    retry_after = next(
        item for item in after["items"] if item["card_id"] == inserted["occurrence_id"]
    )
    assert retry_after["scored"] is True
    assert retry_after["own_rating"] == 3
    assert retry_after["status"] == "done"


def test_waiting_retry_is_reported_but_not_servable():
    plan = _rate(
        plan_from_cards([_card("a"), _card("b")]),
        "a",
        1,
        "enc-1",
        available_at=datetime(2026, 1, 1, 0, 10),
        intraday_kind="retry",
    )

    progress = project_round_progress(plan)

    assert progress["waiting"]["count"] == 1
    assert progress["waiting"]["next_ready_at"] is not None
    assert progress["retry_inserted"] == 0
    pending = _pending(plan, "a")
    assert all(item["card_id"] != pending["occurrence_id"] for item in progress["items"])
