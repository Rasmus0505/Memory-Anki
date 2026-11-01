"""Golden tests for the round command facade.

Each command must produce exactly the plan the underlying rule produces, and
report the parts a caller acts on. These tests are the safety net for stage 2 of
the migration, where the dict writes move inside the commands: as long as the
plans stay equal, behaviour has not changed.
"""

from __future__ import annotations

import json
from datetime import datetime

from memory_anki.modules.practice.domain.round_commands import (
    COMMAND_APPLY_RATING,
    COMMAND_LEAVE_CARD,
    COMMAND_MOVE_CURSOR,
    COMMAND_PUBLISH_READY_RETRIES,
    ApplyRating,
    CompressCompleted,
    LeaveCard,
    MoveCursor,
    PublishReadyRetries,
    apply_command,
)
from memory_anki.modules.practice.domain.round_compress import compress_completed
from memory_anki.modules.practice.domain.round_plan import (
    apply_rating,
    leave_card,
    plan_from_cards,
    set_cursor,
)
from memory_anki.modules.practice.domain.round_plan_intraday import publish_ready_retries

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


def _plan() -> dict:
    return plan_from_cards([_card("a"), _card("b")])


def _snapshot(plan) -> str:
    return json.dumps(plan, sort_keys=True, ensure_ascii=False)


def test_apply_rating_matches_the_rule_it_wraps():
    command = ApplyRating(card_id="a", rating=3, encounter_id="enc-1", round_id=ROUND_ID)

    from_command, event = apply_command(_plan(), command)
    direct = apply_rating(
        _plan(),
        card_id="a",
        rating=3,
        encounter_id="enc-1",
        round_id=ROUND_ID,
    )

    assert _snapshot(from_command) == _snapshot(_plan() if direct is None else direct)
    assert event.command == COMMAND_APPLY_RATING
    assert event.current_card_id == from_command["current_card_id"]
    assert event.completed_ids == from_command["completed_ids"]


def test_a_forgotten_card_reports_the_inserted_retry():
    command = ApplyRating(card_id="a", rating=1, encounter_id="enc-1", round_id=ROUND_ID)

    plan, event = apply_command(_plan(), command)
    inserted = [item["occurrence_id"] for item in plan["occurrences"] if item["status"] == "inserted"]

    assert event.inserted_occurrence_ids == inserted
    assert len(inserted) == 1


def test_leave_card_matches_its_rule():
    rated, _ = apply_command(
        _plan(), ApplyRating(card_id="a", rating=3, encounter_id="enc-1", round_id=ROUND_ID)
    )

    from_command, event = apply_command(rated, LeaveCard(card_id="a"))
    direct = leave_card(rated, "a")

    assert _snapshot(from_command) == _snapshot(direct)
    assert event.command == COMMAND_LEAVE_CARD


def test_move_cursor_matches_its_rule():
    from_command, event = apply_command(_plan(), MoveCursor(card_id="b"))
    direct = set_cursor(_plan(), "b")

    assert _snapshot(from_command) == _snapshot(direct)
    assert event.command == COMMAND_MOVE_CURSOR
    assert from_command["current_card_id"] == "b"


def test_publish_ready_retries_matches_its_rule():
    rated, _ = apply_command(_plan(), ApplyRating(card_id="a", rating=1, encounter_id="enc-1", round_id=ROUND_ID))
    now = datetime(2026, 1, 1, 12, 0)

    from_command, event = apply_command(rated, PublishReadyRetries(now=now))
    direct = publish_ready_retries(rated, now=now)

    assert _snapshot(from_command) == _snapshot(direct)
    assert event.command == COMMAND_PUBLISH_READY_RETRIES


def test_compress_completed_matches_its_rule():
    plan, _ = apply_command(
        _plan(), ApplyRating(card_id="a", rating=3, encounter_id="enc-1", round_id=ROUND_ID)
    )
    plan, _ = apply_command(plan, LeaveCard(card_id="a"))

    from_command, event = apply_command(plan, CompressCompleted())
    direct = compress_completed(plan)

    assert _snapshot(from_command) == _snapshot(direct)
    assert event.command == "compress_completed"
    assert event.compressed_ids == direct["compressed_ids"]


def test_commands_never_mutate_the_plan_they_receive():
    plan = _plan()
    before = _snapshot(plan)

    apply_command(plan, ApplyRating(card_id="a", rating=3, encounter_id="enc-1", round_id=ROUND_ID))
    apply_command(plan, MoveCursor(card_id="b"))
    apply_command(plan, LeaveCard(card_id="a"))

    assert _snapshot(plan) == before
