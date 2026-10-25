"""睡前复习: one palace pass, appended to today's round and never rescheduled."""

from __future__ import annotations

import json

import pytest

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.api import (
    close_unit_review_encounter,
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
)
from memory_anki.modules.practice.application.bedtime_round_service import (
    append_bedtime_review,
    bedtime_candidates,
    rate_bedtime_card,
)
from memory_anki.modules.practice.application.round_state_service import (
    apply_round_action,
    get_or_create_active_round,
    rate_freestyle_round_unit,
)


def _seed_palace(session, title: str, mark_uids: tuple[str, ...]) -> tuple[Palace, list[ReviewUnitState]]:
    palace = Palace(
        title=title,
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": title},
                    "children": [
                        {
                            "data": {
                                "uid": uid,
                                "text": f"节点 {uid}",
                                "permanentSplitMark": True,
                            },
                            "children": [],
                        }
                        for uid in mark_uids
                    ],
                }
            },
            ensure_ascii=False,
        ),
    )
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    units = (
        session.query(ReviewUnitState)
        .filter_by(palace_id=palace.id, active=True)
        .order_by(ReviewUnitState.id.asc())
        .all()
    )
    return palace, units


def _card(unit: ReviewUnitState) -> dict:
    return {
        "id": f"review_unit:{unit.id}:r{unit.revision}",
        "type": "mindmap_branch",
        "kind": "mindmap_branch",
        "unit_id": unit.id,
        "unit_revision": unit.revision,
        "palace_id": unit.palace_id,
        "palace_title": "睡前复习宫殿",
        "label": "节点",
    }


def _rate_today(session, unit: ReviewUnitState, tag: str, rating: int = 3):
    encounter_id = f"encounter-{tag}"
    started = start_freestyle_unit_review_session(
        session,
        unit_id=unit.id,
        unit_revision=unit.revision,
        encounter_id=encounter_id,
        round_id="bedtime-round",
        client_source="desktop",
        card_id=f"card-{tag}",
    )
    rate_review_unit(
        session,
        study_session_id=started["id"],
        unit_id=unit.id,
        unit_revision=unit.revision,
        encounter_id=encounter_id,
        operation_id=f"op-{tag}",
        rating=rating,
    )
    close_unit_review_encounter(
        session,
        study_session_id=started["id"],
        unit_id=unit.id,
        encounter_id=encounter_id,
        operation_id=f"close-{tag}",
    )
    session.commit()


def _setup_round(session, card: dict) -> str:
    round_payload = get_or_create_active_round(
        session,
        scope_key="bedtime-test",
        config={"training_mode": "memory_palace"},
        cards=[card],
        operation_id="round-create",
    )
    return round_payload["round_id"]


def _bedtime_card_id(palace: Palace) -> str:
    return f"bedtime:palace:{palace.id}:{local_day().isoformat()}"


def test_bedtime_appends_one_palace_pass_and_its_grade_never_reschedules(db_session):
    palace, units = _seed_palace(db_session, "睡前复习宫殿", ("node-a",))
    unit = units[0]
    card = _card(unit)
    round_id = _setup_round(db_session, card)

    _rate_today(db_session, unit, "a")
    apply_round_action(
        db_session,
        round_id=round_id,
        action="complete",
        operation_id="complete-a",
        expected_version=0,
        card_id=card["id"],
    )
    db_session.refresh(unit)
    before = (
        unit.due_date,
        unit.stage_index,
        unit.fsrs_last_review,
        unit.early_step,
    )

    candidates = bedtime_candidates(db_session, round_id=round_id)
    assert candidates["count"] == 1
    candidate = candidates["cards"][0]
    assert candidate["palace_pass"] is True
    assert candidate["palace_id"] == palace.id
    assert candidate["unit_id"] == unit.id
    # The whole palace, root included — not the permanent-mark slice.
    assert set(candidate["node_uids"]) == {"root", "node-a"}

    bedtime_id = _bedtime_card_id(palace)
    appended = append_bedtime_review(
        db_session,
        round_id=round_id,
        operation_id="bedtime-append-1",
        expected_version=0,
    )
    assert appended["added_card_ids"] == [bedtime_id]
    assert appended["cards"][0]["palace_pass"] is True
    plan = appended["round"]["plan"]
    assert plan["presented_ids"][-1] == bedtime_id
    original = next(item for item in plan["original_cards"] if item["card_id"] == bedtime_id)
    assert original["bedtime"] is True
    assert original["palace_pass"] is True
    # The unit's own round card keeps its completed state; bedtime is a second,
    # palace-level appearance, not a reopening of that card.
    assert card["id"] in plan["completed_ids"]

    graded = rate_bedtime_card(
        db_session,
        round_id=round_id,
        operation_id="bedtime-rate-1",
        expected_version=0,
        card_id=bedtime_id,
        rating=3,
    )
    db_session.refresh(unit)
    assert (
        unit.due_date,
        unit.stage_index,
        unit.fsrs_last_review,
        unit.early_step,
    ) == before
    graded_plan = graded["round"]["plan"]
    assert graded_plan["bedtime_ratings"][bedtime_id] == {
        "rating": 3,
        "rated_on": graded_plan["today"],
    }
    assert bedtime_id in graded_plan["completed_ids"]

    # The same palace is not offered twice.
    assert bedtime_candidates(db_session, round_id=round_id)["count"] == 0


def test_a_second_palace_is_appended_on_the_next_click(db_session):
    palace_a, units_a = _seed_palace(db_session, "宫殿 A", ("node-a",))
    palace_b, units_b = _seed_palace(db_session, "宫殿 B", ("node-b",))
    round_id = _setup_round(db_session, _card(units_a[0]))

    _rate_today(db_session, units_a[0], "a2")
    apply_round_action(
        db_session,
        round_id=round_id,
        action="complete",
        operation_id="complete-a2",
        expected_version=0,
        card_id=_card(units_a[0])["id"],
    )
    first = append_bedtime_review(
        db_session,
        round_id=round_id,
        operation_id="bedtime-append-a",
        expected_version=0,
    )
    assert first["added_card_ids"] == [_bedtime_card_id(palace_a)]

    # Real-time detection: another palace gets its first rating today.
    _rate_today(db_session, units_b[0], "b2")
    candidates = bedtime_candidates(db_session, round_id=round_id)
    assert candidates["count"] == 1
    assert candidates["cards"][0]["palace_id"] == palace_b.id

    second = append_bedtime_review(
        db_session,
        round_id=round_id,
        operation_id="bedtime-append-b",
        expected_version=0,
    )
    assert second["added_card_ids"] == [_bedtime_card_id(palace_b)]
    assert second["round"]["plan"]["presented_ids"][-1] == _bedtime_card_id(palace_b)


def test_a_palace_with_two_rated_units_is_still_one_bedtime_card(db_session):
    palace, units = _seed_palace(db_session, "双单元宫殿", ("node-a", "node-b"))
    assert len(units) == 2
    round_id = _setup_round(db_session, _card(units[0]))

    _rate_today(db_session, units[0], "unit-a")
    _rate_today(db_session, units[1], "unit-b")
    apply_round_action(
        db_session,
        round_id=round_id,
        action="complete",
        operation_id="complete-unit-a",
        expected_version=0,
        card_id=_card(units[0])["id"],
    )

    candidates = bedtime_candidates(db_session, round_id=round_id)
    assert candidates["count"] == 1
    candidate = candidates["cards"][0]
    assert candidate["palace_id"] == palace.id
    assert candidate["palace_pass"] is True
    assert set(candidate["node_uids"]) == {"root", "node-a", "node-b"}

    appended = append_bedtime_review(
        db_session,
        round_id=round_id,
        operation_id="bedtime-append-both",
        expected_version=0,
    )
    assert appended["added_card_ids"] == [_bedtime_card_id(palace)]

    # Rating more units in the same palace does not queue another pass.
    _rate_today(db_session, units[0], "unit-a-again", rating=4)
    assert bedtime_candidates(db_session, round_id=round_id)["count"] == 0


def test_a_bedtime_card_cannot_be_scored_through_the_review_scheduler(db_session):
    palace, units = _seed_palace(db_session, "守卫宫殿", ("node-a",))
    unit = units[0]
    round_id = _setup_round(db_session, _card(unit))
    _rate_today(db_session, unit, "guard")
    apply_round_action(
        db_session,
        round_id=round_id,
        action="complete",
        operation_id="complete-guard",
        expected_version=0,
        card_id=_card(unit)["id"],
    )
    append_bedtime_review(
        db_session,
        round_id=round_id,
        operation_id="bedtime-append-guard",
        expected_version=0,
    )

    with pytest.raises(ValueError, match="睡前复习"):
        rate_freestyle_round_unit(
            db_session,
            round_id=round_id,
            operation_id="wrong-path",
            expected_version=0,
            card_id=_bedtime_card_id(palace),
            occurrence_id="",
            encounter_id="ignored",
            rating=3,
            study_session_id="",
            unit_id=unit.id,
            unit_revision=unit.revision,
        )
