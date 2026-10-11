import json
from datetime import date, datetime, timedelta

import pytest

from memory_anki.core.time import utc_now_naive
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
    cancel_unrated_unit_review_encounter,
    close_unit_review_encounter,
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
    undo_unit_rating,
)
from memory_anki.modules.session.application.study_session_bridge import (
    audit_inflated_study_sessions,
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


def _start(
    session, state: ReviewUnitState, encounter_id: str,
    client_source: str | None = "desktop", *,
    card_id: str = "source-card", occurrence_id: str = "", retry_attempt: int = 0,
):
    return start_freestyle_unit_review_session(
        session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        round_id="round-2026-07-27",
        client_source=client_source,
        card_id=card_id,
        occurrence_id=occurrence_id,
        retry_attempt=retry_attempt,
    )


def _rate(
    session,
    review_session: dict,
    state: ReviewUnitState,
    encounter_id: str,
    operation_id: str,
    rating: int,
    round_id: str | None = None,
):
    return rate_review_unit(
        session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        operation_id=operation_id,
        rating=rating,
        round_id=round_id,
    )


def test_freestyle_start_restores_active_session_and_open_encounter(db_session):
    state = _seed_review_unit(db_session)
    first = _start(db_session, state, "encounter-first")
    resumed = _start(db_session, state, "encounter-ignored")

    assert resumed["id"] == first["id"]
    assert resumed["units"][0]["encounter"]["id"] == "encounter-first"
    assert resumed["units"][0]["encounter"]["round_id"] == "round-2026-07-27"
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


def test_freestyle_start_adopts_live_revision_instead_of_failing(db_session):
    state = _seed_review_unit(db_session)
    opened = _start(db_session, state, "encounter-live")
    old_revision = int(state.revision)
    state.revision = old_revision + 1
    db_session.commit()

    resumed = start_freestyle_unit_review_session(
        db_session,
        unit_id=state.id,
        unit_revision=old_revision,
        encounter_id="encounter-live",
        round_id="round-2026-07-27",
    )
    unit = resumed["units"][0]
    assert unit["revision"] == old_revision + 1
    assert unit["encounter"]["status"] == "open"
    assert resumed["id"] == opened["id"]


def test_freestyle_start_reopens_after_content_invalidation(db_session):
    state = _seed_review_unit(db_session)
    opened = _start(db_session, state, "encounter-old")
    old_revision = int(state.revision)
    adjust_unit_schedule(
        db_session,
        unit_id=state.id,
        operation_id="invalidate-for-adopt",
        stage_index=state.stage_index,
    )
    db_session.commit()
    db_session.refresh(state)
    assert int(state.revision) != old_revision

    resumed = start_freestyle_unit_review_session(
        db_session,
        unit_id=state.id,
        unit_revision=old_revision,
        encounter_id="encounter-old",
        round_id="round-2026-07-27",
    )
    unit = resumed["units"][0]
    assert resumed["id"] != opened["id"]
    assert unit["revision"] == int(state.revision)
    assert unit["encounter"]["id"] != "encounter-old"
    assert unit["encounter"]["status"] == "open"


def test_retry_glance_does_not_inherit_the_open_parent_rating(db_session):
    state = _seed_review_unit(db_session)
    first = _start(db_session, state, "encounter-source")
    _rate(db_session, first, state, "encounter-source", "rating-hard", 2)

    retry = _start(
        db_session, state, "encounter-retry",
        card_id="retry-card", occurrence_id="retry-card", retry_attempt=1,
    )
    encounter = retry["units"][0]["encounter"]
    assert encounter["id"] == "encounter-retry"
    assert encounter["status"] == "open"
    assert encounter["selected_rating"] is None

    parent = db_session.get(ReviewUnitEncounter, "encounter-source")
    assert parent.status == "closed"
    assert parent.selected_rating == 2
    assert parent.effective_seconds is None
    parent.created_at = utc_now_naive() - timedelta(seconds=30)
    db_session.commit()

    closed = close_unit_review_encounter(
        db_session,
        study_session_id=first["id"],
        unit_id=state.id,
        encounter_id="encounter-source",
        operation_id="close-hard",
        effective_seconds=4,
    )
    assert closed["encounter"]["effective_seconds"] == 4


def test_retry_glance_same_rating_keeps_this_encounter(db_session):
    state = _seed_review_unit(db_session)
    first = _start(db_session, state, "encounter-source")
    _rate(db_session, first, state, "encounter-source", "rating-hard", 2)
    closed = close_unit_review_encounter(
        db_session,
        study_session_id=first["id"],
        unit_id=state.id,
        encounter_id="encounter-source",
        operation_id="close-hard",
    )
    assert closed["session_status"] == "active"

    retry = _start(
        db_session, state, "encounter-retry",
        card_id="retry-card", occurrence_id="retry-card", retry_attempt=1,
    )
    assert retry["units"][0]["encounter"]["id"] == "encounter-retry"
    rated = _rate(db_session, retry, state, "encounter-retry", "rating-retry-hard", 2)

    assert rated["encounter"]["id"] == "encounter-retry"
    assert rated["encounter_id"] == "encounter-retry"
    assert rated["rating"] == 2
    assert rated["passed"] is False


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
    with pytest.raises(ValueError, match="not due"):
        start_freestyle_unit_review_session(
            db_session,
            unit_id=state.id,
            unit_revision=state.revision,
            encounter_id="encounter-other-round",
            round_id="round-other",
        )

    resumed = start_freestyle_unit_review_session(
        db_session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-amend",
        round_id="round-2026-07-27",
        card_id="source-card",
    )
    assert resumed["id"] != review_session["id"]
    assert resumed["units"][0]["encounter"]["id"] == "encounter-amend"
    assert resumed["units"][0]["encounter"]["status"] == "open"
    amended = rate_review_unit(
        db_session,
        study_session_id=resumed["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-amend",
        operation_id="rating-amend",
        rating=4,
        round_id="round-2026-07-27",
    )
    assert amended["amended"] is True
    assert amended["rating"] == 4


def test_today_closed_rating_can_be_undone(db_session):
    state = _seed_review_unit(db_session)
    before = state.due_date
    review_session = _start(db_session, state, "encounter-hard")
    _rate(db_session, review_session, state, "encounter-hard", "rating-hard", 2)
    close_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-hard",
        operation_id="close-hard",
    )

    undone = undo_unit_rating(db_session, "rating-hard")

    assert undone["encounter"]["selected_rating"] is None
    assert undone["encounter"]["effective_operation_id"] is None
    assert state.due_date == before


def test_previous_day_closed_rating_cannot_be_undone(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-old")
    _rate(db_session, review_session, state, "encounter-old", "rating-old", 3)
    close_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-old",
        operation_id="close-old",
    )
    operation = db_session.get(ReviewUnitRatingOperation, "rating-old")
    operation.created_at = utc_now_naive() - timedelta(days=2)
    db_session.commit()

    with pytest.raises(ValueError, match="current open encounter"):
        undo_unit_rating(db_session, "rating-old")


def test_previous_day_rating_does_not_amend_a_new_due_cycle(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-old")
    _rate(db_session, review_session, state, "encounter-old", "rating-old", 3)
    close_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-old",
        operation_id="close-old",
    )
    operation = db_session.get(ReviewUnitRatingOperation, "rating-old")
    operation.created_at = utc_now_naive() - timedelta(days=2)
    state.due_date = date.today()
    state.stage_index = 1
    state.has_passed = True
    db_session.commit()

    again = _rate(
        db_session,
        review_session,
        state,
        "encounter-next",
        "rating-next",
        3,
        round_id="round-2026-07-27",
    )

    assert again["amended"] is False
    assert state.stage_index == 2


def test_start_reopens_passed_unit_when_session_still_active(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-pass")
    _rate(db_session, review_session, state, "encounter-pass", "rating-pass", 3)
    encounter = db_session.get(ReviewUnitEncounter, "encounter-pass")
    encounter.status = "closed"
    encounter.closed_at = utc_now_naive()
    db_session.commit()
    study = db_session.get(StudySession, review_session["id"])
    item = (
        db_session.query(ReviewSessionUnit)
        .filter_by(study_session_id=review_session["id"], unit_id=state.id)
        .one()
    )
    assert study.status == "active"
    assert item.status == "passed"

    resumed = start_freestyle_unit_review_session(
        db_session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-amend",
        round_id="round-2026-07-27",
        card_id="source-card",
        allow_not_due=True,
    )

    assert resumed["id"] != review_session["id"]
    assert resumed["units"][0]["encounter"]["id"] == "encounter-amend"
    assert resumed["units"][0]["encounter"]["status"] == "open"
    assert db_session.get(StudySession, review_session["id"]).status == "completed"
    amended = rate_review_unit(
        db_session,
        study_session_id=resumed["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-amend",
        operation_id="rating-amend-active",
        rating=4,
        round_id="round-2026-07-27",
    )
    assert amended["amended"] is True
    assert amended["rating"] == 4


def test_start_does_not_reuse_open_encounter_from_another_round(db_session):
    state = _seed_review_unit(db_session)
    first = start_freestyle_unit_review_session(
        db_session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-old-round",
        round_id="round-old",
    )
    resumed = start_freestyle_unit_review_session(
        db_session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-new-round",
        round_id="round-new",
    )
    encounter = resumed["units"][0]["encounter"]
    assert resumed["id"] != first["id"]
    assert encounter["id"] == "encounter-new-round"
    assert encounter["round_id"] == "round-new"
    rated = rate_review_unit(
        db_session,
        study_session_id=resumed["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-new-round",
        operation_id="rating-new-round",
        rating=3,
        round_id="round-new",
    )
    assert rated["encounter"]["round_id"] == "round-new"


def test_rate_after_closed_session_overwrites_with_latest_rating(db_session):
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

    amended = _rate(
        db_session,
        review_session,
        state,
        "encounter-pass",
        "rating-overwrite",
        4,
        round_id="round-2026-07-27",
    )

    assert amended["amended"] is True
    assert amended["rating"] == 4
    assert amended["study_session_id"] != review_session["id"]
    assert state.stage_index == 2
    replayed = _rate(
        db_session,
        review_session,
        state,
        "encounter-pass",
        "rating-overwrite",
        4,
        round_id="round-2026-07-27",
    )
    assert replayed["operation_id"] == "rating-overwrite"
    assert replayed["rating"] == 4


def test_rate_after_unrated_abandon_applies_latest_rating(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-glance")
    cancelled = cancel_unrated_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-glance",
    )
    assert cancelled["abandoned"] is True
    study = db_session.get(StudySession, review_session["id"])
    assert study.status == "abandoned"

    rated = _rate(
        db_session,
        review_session,
        state,
        "encounter-glance",
        "rating-after-leave",
        3,
        round_id="round-2026-07-27",
    )

    assert rated["rating"] == 3
    assert rated["passed"] is True
    assert rated["study_session_id"] != review_session["id"]
    assert db_session.get(StudySession, rated["study_session_id"]).status == "active"


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


def test_close_clamps_seconds_beyond_server_wall_span(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-wall-guard")
    _rate(db_session, review_session, state, "encounter-wall-guard", "rating-wall-guard", 3)
    encounter = db_session.query(ReviewUnitEncounter).filter_by(id="encounter-wall-guard").one()
    created_at = utc_now_naive() - timedelta(seconds=5)
    encounter.created_at = created_at
    db_session.commit()

    closed = close_unit_review_encounter(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        encounter_id="encounter-wall-guard",
        operation_id="close-wall-guard",
        effective_seconds=60,
    )

    encounter = db_session.query(ReviewUnitEncounter).filter_by(id="encounter-wall-guard").one()
    wall_seconds = max(0, round((encounter.closed_at - created_at).total_seconds()))
    assert encounter.status == "closed"
    assert encounter.effective_seconds == wall_seconds
    assert encounter.effective_seconds < 60
    assert closed["encounter"]["effective_seconds"] == wall_seconds


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


def test_audit_reports_long_freestyle_encounters_without_repairing_them(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-audit")
    _rate(db_session, review_session, state, "encounter-audit", "rating-audit", 3)
    study = db_session.get(StudySession, review_session["id"])
    encounter = db_session.query(ReviewUnitEncounter).filter_by(id="encounter-audit").one()
    created_at = utc_now_naive() - timedelta(hours=2)
    closed_at = created_at + timedelta(seconds=3601)
    encounter.created_at = created_at
    encounter.closed_at = closed_at
    encounter.status = "closed"
    encounter.effective_seconds = 3601
    study.status = "completed"
    study.ended_at = closed_at
    study.effective_seconds = 3601
    db_session.commit()

    report = audit_inflated_study_sessions(db_session)

    assert report["long_freestyle_encounter_threshold_seconds"] == 3600
    assert report["long_freestyle_encounter_count"] == 1
    assert report["long_freestyle_encounters"] == [
        {
            "encounter_id": "encounter-audit",
            "study_session_id": review_session["id"],
            "unit_id": state.id,
            "title": study.title,
            "effective_seconds": 3601,
            "wall_seconds": 3601,
            "created_at": created_at.isoformat(sep=" "),
            "closed_at": closed_at.isoformat(sep=" "),
            "client_source": "desktop",
        }
    ]
    assert encounter.effective_seconds == 3601


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

    with session_factory() as session:
        encounter = session.get(ReviewUnitEncounter, "http-encounter")
        assert encounter is not None
        encounter.created_at = utc_now_naive() - timedelta(seconds=10)
        session.commit()

    wrong_round_close = client.post(
        f"/api/v1/review/session/{review_session['id']}/units/{unit_id}"
        "/encounters/http-encounter/close",
        json={"operation_id": "http-close-wrong-round", "round_id": "another-round"},
    )
    assert wrong_round_close.status_code == 400
    assert "round_id does not match the active encounter" in wrong_round_close.json()["detail"]

    clamped_close = client.post(
        f"/api/v1/review/session/{review_session['id']}/units/{unit_id}"
        "/encounters/http-encounter/close",
        json={"operation_id": "http-close-impossible-duration", "effective_seconds": 11},
    )
    assert clamped_close.status_code == 200
    clamped_seconds = clamped_close.json()["item"]["encounter"]["effective_seconds"]
    assert clamped_seconds is not None
    assert 9 <= clamped_seconds <= 11
    assert clamped_close.json()["item"]["encounter"]["status"] == "closed"
    assert clamped_close.json()["item"]["completion"]["duration_seconds"] == clamped_seconds

    replayed_close = client.post(
        f"/api/v1/review/session/{review_session['id']}/units/{unit_id}"
        "/encounters/http-encounter/close",
        json={"operation_id": "http-close", "effective_seconds": 9},
    )
    assert replayed_close.status_code == 200
    assert replayed_close.json()["item"]["encounter"]["effective_seconds"] == clamped_seconds


@pytest.mark.parametrize("early", [False, True])
@pytest.mark.parametrize("first_rating", [1, 2])
@pytest.mark.parametrize("passing_rating", [3, 4])
def test_real_retry_preserves_failure_and_preview_matches_commit(
    db_session, early, first_rating, passing_rating,
):
    from memory_anki.modules.memory.application.unit_scheduler import rate_unit

    state = _seed_review_unit(db_session)
    state.stage_index = 7
    state.has_passed = True
    state.due_date = date.today() + timedelta(days=14 if early else 0)
    db_session.commit()
    first = start_freestyle_unit_review_session(
        db_session, unit_id=state.id, unit_revision=state.revision,
        encounter_id="real-source", round_id="real-round", card_id="source",
        allow_not_due=early,
    )
    failed = _rate(db_session, first, state, "real-source", "real-fail", first_rating)
    lowered = failed["unit"]["stage_index"]
    close_unit_review_encounter(
        db_session, study_session_id=first["id"], unit_id=state.id,
        encounter_id="real-source", operation_id="real-close",
    )
    # A feed glance can be abandoned while other cards are practiced.
    study = db_session.get(StudySession, first["id"])
    study.status = "abandoned"
    db_session.commit()
    retry = start_freestyle_unit_review_session(
        db_session, unit_id=state.id, unit_revision=state.revision,
        encounter_id="real-retry", round_id="real-round", card_id="retry-slot",
        occurrence_id="retry-slot", retry_attempt=1,
    )
    effect = next(x for x in retry["units"][0]["encounter"]["rating_effects"] if x["rating"] == passing_rating)
    passed = _rate(db_session, retry, state, "real-retry", "real-pass", passing_rating)
    expected = rate_unit(
        stage_index=lowered, has_passed=True, rating=passing_rating,
        had_failure_in_encounter=True, today=date.today(), fuzz_key=state.id,
    )
    assert state.stage_index == expected.stage_index
    assert state.due_date == expected.due_date
    assert effect["target_stage_index"] == state.stage_index
    assert effect["target_due_date"] == state.due_date.isoformat()
    assert passed["amended"] is False
    assert db_session.get(ReviewUnitRatingOperation, "real-fail").replaced_at is None
    assert db_session.get(ReviewUnitRatingOperation, "real-pass").replaces_operation_id is None
    item = db_session.query(ReviewSessionUnit).filter_by(study_session_id=retry["id"]).one()
    assert item.retry_count == 1
    assert (item.again_count, item.hard_count) == (int(first_rating == 1), int(first_rating == 2))
    from memory_anki.modules.memory.application.unit_review_service import get_unit_review_session

    historical = get_unit_review_session(db_session, first['id'], encounter_id='real-source')
    assert historical['units'][0]['encounter']['id'] == 'real-source'
    assert historical['units'][0]['encounter']['rating_editable'] is False
    with pytest.raises(ValueError, match="后续真实练习"):
        undo_unit_rating(db_session, "real-fail")
    with pytest.raises(ValueError, match="后续真实练习"):
        start_freestyle_unit_review_session(
            db_session, unit_id=state.id, unit_revision=state.revision,
            encounter_id="source-revisit", round_id="real-round", card_id="source",
        )
    assert state.stage_index == expected.stage_index
    undo_unit_rating(db_session, "real-pass")
    assert state.stage_index == lowered
    assert state.due_date == date.today()
    assert item.retry_count == 1


def test_retry_slot_new_attempt_stacks_penalty_but_correction_does_not(db_session):
    state = _seed_review_unit(db_session)
    state.stage_index = 7
    state.has_passed = True
    db_session.commit()
    first = _start(db_session, state, "source")
    _rate(db_session, first, state, "source", "source-hard", 2)
    assert state.stage_index == 6
    for attempt in (1, 2):
        retry = _start(
            db_session, state, f"retry-{attempt}", card_id="same-slot",
            occurrence_id="same-slot", retry_attempt=attempt,
        )
        _rate(db_session, retry, state, f"retry-{attempt}", f"hard-{attempt}", 2)
        assert state.stage_index == 6 - attempt
    corrected = _rate(db_session, retry, state, "retry-2", "correct-last", 3)
    assert corrected["amended"] is True
    assert state.stage_index == 5
    item = db_session.query(ReviewSessionUnit).filter_by(study_session_id=retry["id"]).one()
    assert item.retry_count == 2
    assert item.hard_count == 2
    assert db_session.get(ReviewUnitRatingOperation, "hard-2").replaced_at is not None
    assert db_session.get(ReviewUnitRatingOperation, "hard-1").replaced_at is None
    undo_unit_rating(db_session, "correct-last")
    assert state.stage_index == 4
    assert item.retry_count == 3


def test_same_attempt_revisit_correction_uses_preview_baseline(db_session):
    state = _seed_review_unit(db_session)
    state.stage_index = 7
    state.has_passed = True
    db_session.commit()
    first = _start(db_session, state, "source")
    _rate(db_session, first, state, "source", "source-hard", 2)
    close_unit_review_encounter(
        db_session, study_session_id=first["id"], unit_id=state.id,
        encounter_id="source", operation_id="source-close",
    )
    revisit = _start(db_session, state, "source-revisit")
    effect = next(x for x in revisit["units"][0]["encounter"]["rating_effects"] if x["rating"] == 3)
    corrected = _rate(db_session, revisit, state, "source-revisit", "source-corrected", 3)
    assert corrected["amended"] is True
    assert state.stage_index == 8
    assert effect["target_stage_index"] == 8
    assert effect["target_due_date"] == state.due_date.isoformat()
    assert db_session.query(ReviewSessionUnit).one().retry_count == 0
    undo_unit_rating(db_session, "source-corrected")
    assert state.stage_index == 6
    assert db_session.query(ReviewSessionUnit).one().retry_count == 1
