"""Re-rating one review unit replaces its single rating and reschedules from the baseline."""

import json

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.unit_review_service import (
    close_unit_review_encounter,
    list_latest_unit_ratings,
    rate_review_unit,
    reconcile_palace_units,
    rerate_unit_rating,
    rerate_unit_ratings,
    start_freestyle_unit_review_session,
)

ROUND_ID = "round-rerate"


def _seed_review_unit(session) -> ReviewUnitState:
    palace = Palace(
        title="改评分测试宫殿",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {
                        "uid": "root",
                        "text": "改评分测试宫殿",
                        "permanentSplitMark": True,
                    },
                    "children": [{"data": {"uid": "node-a", "text": "节点 A"}, "children": []}],
                }
            },
            ensure_ascii=False,
        ),
    )
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    return session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True).one()


def _rate_and_close(session, state: ReviewUnitState, encounter_id: str, rating: int) -> dict:
    review_session = start_freestyle_unit_review_session(
        session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        round_id=ROUND_ID,
        client_source="desktop",
        card_id="source-card",
    )
    rate_review_unit(
        session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        operation_id=f"rating-{encounter_id}",
        rating=rating,
        round_id=ROUND_ID,
    )
    close_unit_review_encounter(
        session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id=encounter_id,
        operation_id=f"close-{encounter_id}",
    )
    return review_session


def _fresh_stage_after(session, rating: int) -> int:
    """Stage a brand-new unit reaches with this rating, the reference for a re-rate."""
    state = _seed_review_unit(session)
    _rate_and_close(session, state, f"fresh-{rating}", rating)
    return state.stage_index


def test_rerate_replaces_rating_without_stacking_a_second_promotion(db_session):
    state = _seed_review_unit(db_session)
    _rate_and_close(db_session, state, "encounter-easy", 4)
    assert state.stage_index >= 1

    result = rerate_unit_rating(
        db_session,
        unit_id=state.id,
        operation_id="rerate-forgot",
        rating=1,
        expected_revision=state.revision,
    )

    assert result["rating"] == 1
    assert result["amended"] is True
    assert state.stage_index == 0
    replaced = db_session.get(ReviewUnitRatingOperation, "rating-encounter-easy")
    assert replaced.replaced_at is not None
    encounter = db_session.get(ReviewUnitEncounter, "encounter-easy")
    assert encounter.selected_rating == 1


def test_rerate_matches_a_fresh_rating_of_the_same_grade(db_session):
    expected_stage = _fresh_stage_after(db_session, 2)
    state = _seed_review_unit(db_session)
    _rate_and_close(db_session, state, "encounter-first", 4)

    rerate_unit_rating(
        db_session,
        unit_id=state.id,
        operation_id="rerate-hard",
        rating=2,
        expected_revision=state.revision,
    )

    assert state.stage_index == expected_stage


def test_rerate_same_operation_id_is_idempotent(db_session):
    state = _seed_review_unit(db_session)
    _rate_and_close(db_session, state, "encounter-idem", 3)

    first = rerate_unit_rating(
        db_session,
        unit_id=state.id,
        operation_id="rerate-once",
        rating=4,
        expected_revision=state.revision,
    )
    stage_after_first = state.stage_index
    second = rerate_unit_rating(
        db_session,
        unit_id=state.id,
        operation_id="rerate-once",
        rating=4,
        expected_revision=state.revision,
    )

    assert second == first
    assert state.stage_index == stage_after_first


def test_rerate_rejects_a_stale_revision(db_session):
    state = _seed_review_unit(db_session)
    _rate_and_close(db_session, state, "encounter-stale", 3)

    with pytest.raises(ValueError, match="changed"):
        rerate_unit_rating(
            db_session,
            unit_id=state.id,
            operation_id="rerate-stale",
            rating=1,
            expected_revision=state.revision + 1,
        )


def test_rerate_without_any_rating_is_refused(db_session):
    state = _seed_review_unit(db_session)

    with pytest.raises(ValueError, match="no rating"):
        rerate_unit_rating(
            db_session,
            unit_id=state.id,
            operation_id="rerate-none",
            rating=1,
            expected_revision=state.revision,
        )


def test_latest_unit_ratings_reflect_the_rerated_value(db_session):
    state = _seed_review_unit(db_session)
    _rate_and_close(db_session, state, "encounter-view", 3)

    rerate_unit_rating(
        db_session,
        unit_id=state.id,
        operation_id="rerate-view",
        rating=1,
        expected_revision=state.revision,
    )

    ratings = list_latest_unit_ratings(db_session, state.palace_id)
    assert ratings[state.id] == {
        "rating": 1,
        "operation_id": "rerate-view",
        "revision": state.revision,
    }


def _seed_two_marked_units(session) -> list[ReviewUnitState]:
    """Two sibling permanent marks under an unmarked root: two review units in one palace."""
    palace = Palace(
        title="级联改评分测试宫殿",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "根"},
                    "children": [
                        {"data": {"uid": "a", "text": "甲", "permanentSplitMark": True}, "children": []},
                        {"data": {"uid": "b", "text": "乙", "permanentSplitMark": True}, "children": []},
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
    marked = {"a", "b"}
    return [
        state
        for state in session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True).all()
        if state.anchor_uid in marked
    ]


def test_batch_rerate_sets_every_unit_and_keeps_one_rating_each(db_session):
    units = _seed_two_marked_units(db_session)
    assert len(units) == 2
    for index, state in enumerate(units):
        _rate_and_close(db_session, state, f"batch-enc-{index}", 4)

    result = rerate_unit_ratings(
        db_session,
        palace_id=units[0].palace_id,
        rating=2,
        items=[
            {"unit_id": state.id, "operation_id": f"batch-op-{index}", "expected_revision": state.revision}
            for index, state in enumerate(units)
        ],
    )

    assert len(result["items"]) == 2
    ratings = list_latest_unit_ratings(db_session, units[0].palace_id)
    assert {ratings[state.id]["rating"] for state in units} == {2}


def test_batch_rerate_rolls_back_all_items_when_one_is_stale(db_session):
    units = _seed_two_marked_units(db_session)
    for index, state in enumerate(units):
        _rate_and_close(db_session, state, f"rollback-enc-{index}", 4)
    before = list_latest_unit_ratings(db_session, units[0].palace_id)

    with pytest.raises(ValueError, match="changed"):
        rerate_unit_ratings(
            db_session,
            palace_id=units[0].palace_id,
            rating=1,
            items=[
                {"unit_id": units[0].id, "operation_id": "rollback-op-0", "expected_revision": units[0].revision},
                {"unit_id": units[1].id, "operation_id": "rollback-op-1", "expected_revision": units[1].revision + 9},
            ],
        )

    assert list_latest_unit_ratings(db_session, units[0].palace_id) == before


def test_batch_rerate_refuses_units_from_another_palace(db_session):
    units = _seed_two_marked_units(db_session)
    _rate_and_close(db_session, units[0], "foreign-enc", 3)

    with pytest.raises(ValueError, match="this palace"):
        rerate_unit_ratings(
            db_session,
            palace_id=units[0].palace_id + 999,
            rating=1,
            items=[
                {"unit_id": units[0].id, "operation_id": "foreign-op", "expected_revision": units[0].revision},
            ],
        )
