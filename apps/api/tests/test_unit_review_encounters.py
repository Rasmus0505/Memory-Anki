import json
from datetime import date, datetime, timedelta

import pytest

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewSessionUnit,
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.unit_review_service import (
    adjust_unit_schedule,
    close_unit_review_encounter,
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
    undo_unit_rating,
)


def _seed_review_unit(session) -> ReviewUnitState:
    palace = Palace(
        title="出现记录测试宫殿",
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {
                        "uid": "root",
                        "text": "出现记录测试宫殿",
                        "permanentSplitMark": True,
                    },
                    "children": [
                        {
                            "data": {"uid": "node-a", "text": "节点 A"},
                            "children": [],
                        }
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
    return session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True).one()


def _start(session, state: ReviewUnitState, encounter_id: str, client_source: str | None = "desktop"):
    return start_freestyle_unit_review_session(
        session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        round_id="round-2026-07-27",
        client_source=client_source,
    )


def _rate(
    session,
    review_session: dict,
    state: ReviewUnitState,
    encounter_id: str,
    operation_id: str,
    rating: int,
):
    return rate_review_unit(
        session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        operation_id=operation_id,
        rating=rating,
    )


def test_freestyle_start_restores_active_session_and_open_encounter(db_session):
    state = _seed_review_unit(db_session)
    first = _start(db_session, state, "encounter-first")
    resumed = _start(db_session, state, "encounter-ignored")

    assert resumed["id"] == first["id"]
    assert resumed["units"][0]["encounter"]["id"] == "encounter-first"
    assert db_session.query(StudySession).filter_by(scene="freestyle_unit_review").count() == 1
    assert db_session.query(ReviewUnitEncounter).count() == 1
    # Resume must keep the open glance so an in-flight rate with the original
    # encounter_id does not 400 with "open review encounter required".
    rated = _rate(db_session, resumed, state, "encounter-first", "rating-after-resume", 3)
    assert rated["encounter"]["id"] == "encounter-first"
    assert rated["passed"] is True
    # editor_doc must be a parsed object (not raw SQLite TEXT) so freestyle permanent-mark
    # chips/toggles can read permanentSplitMark on node data.
    editor_doc = first["palace"]["editor_doc"]
    assert isinstance(editor_doc, dict)
    assert editor_doc["root"]["data"]["permanentSplitMark"] is True


def test_freestyle_fill_session_can_explicitly_open_a_not_due_unit(db_session):
    state = _seed_review_unit(db_session)
    state.due_date = date.today() + timedelta(days=3)
    db_session.commit()

    with pytest.raises(ValueError, match="not due"):
        _start(db_session, state, "encounter-not-due")

    opened = start_freestyle_unit_review_session(
        db_session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-fill",
        round_id="round-fill",
        allow_not_due=True,
    )
    assert opened["units"][0]["encounter"]["id"] == "encounter-fill"


def test_invalidating_a_freestyle_session_closes_its_open_encounter(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-invalidated")

    adjust_unit_schedule(
        db_session,
        unit_id=state.id,
        operation_id="invalidate-open-encounter",
        stage_index=state.stage_index,
    )
    db_session.commit()

    study = db_session.get(StudySession, review_session["id"])
    encounter = db_session.get(ReviewUnitEncounter, "encounter-invalidated")
    assert study.status == "invalidated"
    assert encounter.status == "closed"
    assert encounter.selected_rating is None
    assert encounter.closed_at is not None


def test_one_encounter_amends_from_frozen_baseline_and_is_idempotent(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-amend")

    remembered = _rate(db_session, review_session, state, "encounter-amend", "rating-remembered", 3)
    easy = _rate(db_session, review_session, state, "encounter-amend", "rating-easy", 4)
    duplicate = _rate(db_session, review_session, state, "encounter-amend", "rating-easy", 4)

    assert remembered["unit"]["stage_index"] == 1
    assert easy["amended"] is True
    assert easy["unit"]["stage_index"] == 2
    assert duplicate == easy

    hard = _rate(db_session, review_session, state, "encounter-amend", "rating-hard", 2)
    corrected = _rate(db_session, review_session, state, "encounter-amend", "rating-corrected", 3)
    item = db_session.query(ReviewSessionUnit).one()

    assert hard["unit"]["stage_index"] == 0
    assert hard["passed"] is False
    assert corrected["unit"]["stage_index"] == 1
    assert corrected["passed"] is True
    assert item.retry_count == 0
    assert db_session.query(ReviewUnitRatingOperation).count() == 4
    assert db_session.get(ReviewUnitRatingOperation, "rating-hard").replaced_at is not None


def test_undo_restores_the_previous_choice_in_same_open_encounter(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-undo")
    _rate(db_session, review_session, state, "encounter-undo", "rating-before", 3)
    _rate(db_session, review_session, state, "encounter-undo", "rating-after", 4)

    undone = undo_unit_rating(db_session, "rating-after")

    assert undone["unit"]["stage_index"] == 1
    assert undone["encounter"]["selected_rating"] == 3
    assert undone["encounter"]["effective_operation_id"] == "rating-before"


def test_closed_pass_locks_rating_and_future_unit_cannot_restart(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-pass")
    _rate(db_session, review_session, state, "encounter-pass", "rating-pass", 3)
    closed = close_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-pass",
        operation_id="close-pass",
    )

    assert closed["session_status"] == "completed"
    assert state.stage_index == 1
    assert state.due_date == date.today() + timedelta(days=1)
    with pytest.raises(ValueError, match="active unit review session required"):
        _rate(db_session, review_session, state, "encounter-pass", "rating-too-late", 4)
    with pytest.raises(ValueError, match="current open encounter"):
        undo_unit_rating(db_session, "rating-pass")
    with pytest.raises(ValueError, match="not due"):
        _start(db_session, state, "encounter-future")


def test_freestyle_complete_preserves_client_source_in_summary(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-source", client_source="pwa")
    study = db_session.get(StudySession, review_session["id"])
    assert '"client_source": "pwa"' in (study.summary_json or "")

    _rate(db_session, review_session, state, "encounter-source", "rating-source", 3)
    closed = close_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-source",
        operation_id="close-source",
    )

    assert closed["session_status"] == "completed"
    assert closed["completion"]["client_source"] == "pwa"
    db_session.refresh(study)
    summary = json.loads(study.summary_json or "{}")
    assert summary["client_source"] == "pwa"
    assert summary["completed_unit_count"] == 1


def test_close_uses_client_observed_foreground_seconds(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-foreground")
    _rate(db_session, review_session, state, "encounter-foreground", "rating-foreground", 3)
    encounter = db_session.query(ReviewUnitEncounter).filter_by(id="encounter-foreground").one()
    encounter.created_at = datetime.now() - timedelta(hours=12)
    db_session.commit()

    closed = close_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-foreground",
        operation_id="close-foreground",
        effective_seconds=7,
    )

    assert closed["session_status"] == "completed"
    encounter = db_session.query(ReviewUnitEncounter).filter_by(id="encounter-foreground").one()
    study = db_session.get(StudySession, review_session["id"])
    assert encounter.effective_seconds == 7
    assert study.effective_seconds == 7
    assert closed["completion"]["duration_seconds"] == 7


def test_close_without_observed_seconds_does_not_bill_wall_clock(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-no-clock")
    _rate(db_session, review_session, state, "encounter-no-clock", "rating-no-clock", 3)
    encounter = db_session.query(ReviewUnitEncounter).filter_by(id="encounter-no-clock").one()
    encounter.created_at = datetime.now() - timedelta(hours=12)
    db_session.commit()

    closed = close_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-no-clock",
        operation_id="close-no-clock",
    )

    study = db_session.get(StudySession, review_session["id"])
    assert study.effective_seconds == 0
    assert closed["completion"]["duration_seconds"] == 0


def test_failed_close_keeps_session_and_next_encounter_retains_penalty(db_session):
    state = _seed_review_unit(db_session)
    first = _start(db_session, state, "encounter-hard")
    _rate(db_session, first, state, "encounter-hard", "rating-hard", 2)
    closed = close_unit_review_encounter(
        db_session,
        study_session_id=first["id"],
        unit_id=state.id,
        encounter_id="encounter-hard",
        operation_id="close-hard",
    )
    assert closed["passed"] is False
    assert closed["session_status"] == "active"

    second = _start(db_session, state, "encounter-retry")
    assert second["id"] == first["id"]
    assert second["units"][0]["encounter"]["sequence"] == 1
    remembered = _rate(
        db_session,
        second,
        state,
        "encounter-retry",
        "rating-after-hard",
        3,
    )

    assert remembered["passed"] is True
    assert remembered["unit"]["stage_index"] == 1
    assert remembered["unit"]["due_date"] == (date.today() + timedelta(days=1)).isoformat()
    assert remembered["unit"]["due_date"] == (date.today() + timedelta(days=1)).isoformat()


def test_review_http_contract_carries_encounter_identity(session_factory, make_client):
    from memory_anki.modules.memory.presentation import router as review_router

    with session_factory() as session:
        state = _seed_review_unit(session)
        unit_id = state.id
        revision = state.revision

    client = make_client(review_router)
    started = client.post(
        f"/api/v1/review/units/{unit_id}/sessions",
        json={
            "unit_revision": revision,
            "round_id": "http-round",
            "encounter_id": "http-encounter",
            "clientSource": "desktop",
        },
    )
    assert started.status_code == 200
    review_session = started.json()["item"]
    assert review_session["units"][0]["encounter"]["id"] == "http-encounter"

    with session_factory() as session:
        study = session.get(StudySession, review_session["id"])
        assert study is not None
        assert json.loads(study.summary_json or "{}").get("client_source") == "desktop"

    rated = client.post(
        f"/api/v1/review/session/{review_session['id']}/units/{unit_id}/ratings",
        json={
            "unit_revision": revision,
            "encounter_id": "http-encounter",
            "operation_id": "http-rating",
            "rating": 3,
        },
    )
    assert rated.status_code == 200
    assert rated.json()["item"]["unit"]["stage_index"] == 1
    assert len(rated.json()["item"]["encounter"]["rating_effects"]) == 4

    closed = client.post(
        f"/api/v1/review/session/{review_session['id']}/units/{unit_id}"
        "/encounters/http-encounter/close",
        json={"operation_id": "http-close", "effective_seconds": 9},
    )
    assert closed.status_code == 200
    assert closed.json()["item"]["encounter"]["status"] == "closed"
    assert closed.json()["item"]["encounter"]["effective_seconds"] == 9
    assert closed.json()["item"]["completion"]["duration_seconds"] == 9
