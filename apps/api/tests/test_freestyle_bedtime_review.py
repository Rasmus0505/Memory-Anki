"""睡前复习: append today's rated units and score them without rescheduling."""

from __future__ import annotations

import json

import pytest

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


def _seed_units(session):
    palace = Palace(
        title="睡前复习宫殿",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "睡前复习宫殿"},
                    "children": [
                        {
                            "data": {
                                "uid": "node-a",
                                "text": "节点 A",
                                "permanentSplitMark": True,
                            },
                            "children": [],
                        },
                        {
                            "data": {
                                "uid": "node-b",
                                "text": "节点 B",
                                "permanentSplitMark": True,
                            },
                            "children": [],
                        },
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
    assert len(units) == 2
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


def _setup_round(session, units):
    card_a = _card(units[0])
    round_payload = get_or_create_active_round(
        session,
        scope_key="bedtime-test",
        config={"training_mode": "memory_palace"},
        cards=[card_a],
        operation_id="round-create",
    )
    return round_payload["round_id"], card_a["id"]


def test_bedtime_appends_a_rated_card_and_its_grade_never_reschedules(db_session):
    _, units = _seed_units(db_session)
    round_id, card_a = _setup_round(db_session, units)
    unit_a, unit_b = units

    _rate_today(db_session, unit_a, "a")
    apply_round_action(
        db_session,
        round_id=round_id,
        action="complete",
        operation_id="complete-a",
        expected_version=0,
        card_id=card_a,
    )
    db_session.refresh(unit_a)
    before = (
        unit_a.due_date,
        unit_a.stage_index,
        unit_a.fsrs_last_review,
        unit_a.early_step,
    )

    # B has not been rated today, so only A is a bedtime candidate.
    candidates = bedtime_candidates(db_session, round_id=round_id)
    assert candidates["count"] == 1
    assert candidates["cards"][0]["unit_id"] == unit_a.id
    assert candidates["cards"][0]["bedtime"] is True

    appended = append_bedtime_review(
        db_session,
        round_id=round_id,
        operation_id="bedtime-append-1",
        expected_version=0,
    )
    assert appended["added_card_ids"] == [card_a]
    plan = appended["round"]["plan"]
    assert plan["presented_ids"][-1] == card_a
    original = next(item for item in plan["original_cards"] if item["card_id"] == card_a)
    assert original["bedtime"] is True
    # A completed card is reopened as the bedtime appearance, at the end.
    assert card_a not in plan["completed_ids"]
    assert appended["cards"][0]["type"] == "mindmap_branch"

    graded = rate_bedtime_card(
        db_session,
        round_id=round_id,
        operation_id="bedtime-rate-1",
        expected_version=0,
        card_id=card_a,
        rating=3,
    )
    db_session.refresh(unit_a)
    assert (
        unit_a.due_date,
        unit_a.stage_index,
        unit_a.fsrs_last_review,
        unit_a.early_step,
    ) == before
    graded_plan = graded["round"]["plan"]
    assert graded_plan["bedtime_ratings"][card_a] == {"rating": 3, "rated_on": graded_plan["today"]}
    assert card_a in graded_plan["completed_ids"]

    # The same card is not offered twice.
    assert bedtime_candidates(db_session, round_id=round_id)["count"] == 0


def test_a_card_rated_after_the_first_pass_is_appended_on_the_next_click(db_session):
    _, units = _seed_units(db_session)
    round_id, card_a = _setup_round(db_session, units)
    unit_a, unit_b = units

    _rate_today(db_session, unit_a, "a2")
    apply_round_action(
        db_session,
        round_id=round_id,
        action="complete",
        operation_id="complete-a2",
        expected_version=0,
        card_id=card_a,
    )
    first = append_bedtime_review(
        db_session,
        round_id=round_id,
        operation_id="bedtime-append-a",
        expected_version=0,
    )
    assert first["added_card_ids"] == [card_a]

    # Real-time detection: rate another unit, then click 睡前复习 again.
    _rate_today(db_session, unit_b, "b2")
    candidates = bedtime_candidates(db_session, round_id=round_id)
    assert candidates["count"] == 1
    assert candidates["cards"][0]["unit_id"] == unit_b.id

    second = append_bedtime_review(
        db_session,
        round_id=round_id,
        operation_id="bedtime-append-b",
        expected_version=0,
    )
    second_card_id = f"review_unit:{unit_b.id}:r{unit_b.revision}"
    assert second["added_card_ids"] == [second_card_id]
    assert second["round"]["plan"]["presented_ids"][-1] == second_card_id


def test_a_bedtime_card_cannot_be_scored_through_the_review_scheduler(db_session):
    _, units = _seed_units(db_session)
    round_id, card_a = _setup_round(db_session, units)
    _rate_today(db_session, units[0], "guard")
    apply_round_action(
        db_session,
        round_id=round_id,
        action="complete",
        operation_id="complete-guard",
        expected_version=0,
        card_id=card_a,
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
            card_id=card_a,
            occurrence_id="",
            encounter_id="ignored",
            rating=3,
            study_session_id="",
            unit_id=units[0].id,
            unit_revision=units[0].revision,
        )
