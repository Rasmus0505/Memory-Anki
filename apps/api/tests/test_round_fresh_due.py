import json
from datetime import date, timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitRatingOperation
from memory_anki.modules.memory.application.unit_review_service import (
    close_unit_review_encounter,
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
)
from memory_anki.modules.practice.application.round_fresh_due import project_served_plan


def _seed(session):
    palace = Palace(
        title="到期再出现",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "到期再出现", "permanentSplitMark": True},
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
    from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

    return session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True).one()


def _plan(unit_id: str, card_id: str = "card-a") -> dict:
    return {
        "original_cards": [{
            "card_id": card_id,
            "unit_id": unit_id,
            "unit_revision": 1,
            "kind": "mindmap_branch",
            "palace_id": 1,
            "palace_title": "到期再出现",
            "label": "节点 A",
        }],
        "presented_ids": [card_id],
        "current_card_id": card_id,
        "current_index": 0,
        "completed_ids": [card_id],
        "excluded_ids": [],
        "compressed_ids": [],
        "occurrences": [{
            "occurrence_id": f"retry:{card_id}:1",
            "source_card_id": card_id,
            "source_unit_id": unit_id,
            "retry_attempt": 1,
            "rating": 3,
            "insert_target_index": 1,
            "status": "completed",
            "encounter_id": "enc-1",
        }],
        "encounters": {
            card_id: {
                "encounter_id": "enc-1",
                "status": "passed",
                "unit_revision": 1,
                "rating": 3,
            }
        },
        "today": "2026-10-11",
    }


def _rate_and_close(session, state, rating: int, operation_id: str):
    started = start_freestyle_unit_review_session(
        session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="enc-1",
        round_id="round-fresh",
        client_source="desktop",
    )
    rate_review_unit(
        session,
        study_session_id=started["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="enc-1",
        operation_id=operation_id,
        rating=rating,
        round_id="round-fresh",
    )
    close_unit_review_encounter(
        session,
        study_session_id=started["id"],
        unit_id=state.id,
        encounter_id="enc-1",
        operation_id=f"close-{operation_id}",
    )


def test_previous_visit_score_is_stripped_when_the_card_is_due_again(db_session):
    state = _seed(db_session)
    _rate_and_close(db_session, state, 3, "op-old")
    operation = db_session.get(ReviewUnitRatingOperation, "op-old")
    operation.created_at = utc_now_naive() - timedelta(days=2)
    state.due_date = date.today()
    db_session.commit()
    persisted = _plan(state.id)

    served = project_served_plan(db_session, persisted)

    assert served["fresh_due_ids"] == ["card-a", "retry:card-a:1"]
    assert "card-a" not in served["encounters"]
    assert "card-a" not in served["completed_ids"]
    assert served["occurrences"][0]["rating"] is None
    assert persisted["encounters"]["card-a"]["rating"] == 3


def test_today_hard_rating_stays_visible(db_session):
    state = _seed(db_session)
    _rate_and_close(db_session, state, 2, "op-hard")
    db_session.commit()
    assert state.due_date == date.today()

    served = project_served_plan(db_session, _plan(state.id))

    assert "fresh_due_ids" not in served
    assert served["encounters"]["card-a"]["rating"] == 3


def test_future_due_card_keeps_its_score(db_session):
    state = _seed(db_session)
    _rate_and_close(db_session, state, 3, "op-pass")
    db_session.commit()
    assert state.due_date > date.today()

    served = project_served_plan(db_session, _plan(state.id))

    assert "fresh_due_ids" not in served
    assert served["completed_ids"] == ["card-a"]


def test_excluded_due_card_is_not_released(db_session):
    state = _seed(db_session)
    _rate_and_close(db_session, state, 3, "op-hidden")
    operation = db_session.get(ReviewUnitRatingOperation, "op-hidden")
    operation.created_at = utc_now_naive() - timedelta(days=2)
    state.due_date = date.today()
    db_session.commit()
    plan = _plan(state.id)
    plan["excluded_ids"] = ["card-a"]

    served = project_served_plan(db_session, plan)

    assert "card-a" not in served.get("fresh_due_ids", [])
    assert served["encounters"]["card-a"]["rating"] == 3
