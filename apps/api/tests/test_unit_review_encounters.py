import json
from datetime import timedelta

import pytest

from memory_anki.core.time import local_day, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewSessionUnit,
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.unit_fsrs_adapter import FsrsUnitState
from memory_anki.modules.memory.application.unit_intraday import IntradayState
from memory_anki.modules.memory.application.unit_review_service import (
    adjust_unit_schedule,
    attempt_identity_matches,
    cancel_unrated_unit_review_encounter,
    close_unit_review_encounter,
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
    undo_unit_rating,
)


def _fsrs_state(state: ReviewUnitState) -> FsrsUnitState | None:
    """The persisted FSRS card, which is what the next rating actually starts from."""
    if state.fsrs_stability is None and state.fsrs_state is None:
        return None
    return FsrsUnitState(
        stability=state.fsrs_stability,
        difficulty=state.fsrs_difficulty,
        fsrs_state=state.fsrs_state,
        step=state.fsrs_step,
        due_at=state.fsrs_due_at,
        last_review=state.fsrs_last_review,
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
    state.due_date = local_day() + timedelta(days=3)
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
    _rate(db_session, first, state, "encounter-source", "rating-hard", 1)

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
    assert parent.selected_rating == 1
    parent.created_at = utc_now_naive() - timedelta(seconds=30)
    db_session.commit()

    closed = close_unit_review_encounter(
        db_session,
        study_session_id=first["id"],
        unit_id=state.id,
        encounter_id="encounter-source",
        operation_id="close-hard",
    )
    assert closed["encounter"]["status"] == "closed"


def test_retry_glance_same_rating_keeps_this_encounter(db_session):
    state = _seed_review_unit(db_session)
    first = _start(db_session, state, "encounter-source")
    _rate(db_session, first, state, "encounter-source", "rating-hard", 1)
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
    rated = _rate(db_session, retry, state, "encounter-retry", "rating-retry-hard", 1)

    assert rated["encounter"]["id"] == "encounter-retry"
    assert rated["encounter_id"] == "encounter-retry"
    assert rated["rating"] == 1
    assert rated["passed"] is False


def test_one_encounter_amends_from_frozen_baseline_and_is_idempotent(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-amend")

    remembered = _rate(db_session, review_session, state, "encounter-amend", "rating-remembered", 3)
    remembered_stability = _fsrs_state(state).stability
    easy = _rate(db_session, review_session, state, "encounter-amend", "rating-easy", 4)
    duplicate = _rate(db_session, review_session, state, "encounter-amend", "rating-easy", 4)

    assert remembered["unit"]["stage_index"] == 1
    assert easy["amended"] is True
    # 记得 on a first pass books the same-day re-check; 轻松 skips it and books
    # three days, so only the remembered glance carries a step. The memory
    # model still distinguishes them: 轻松 leaves a more stable card.
    assert remembered["intraday_kind"] == "step"
    assert easy["intraday_kind"] is None
    assert easy["unit"]["stage_index"] == 2
    assert _fsrs_state(state).stability > remembered_stability
    assert duplicate == easy

    hard = _rate(db_session, review_session, state, "encounter-amend", "rating-hard", 1)
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
    assert state.stage_index >= 1
    # The first pass books a same-day re-check, so the unit is still due today.
    assert state.due_date == local_day()
    assert state.intraday_step_pending is True
    # Once the wait elapses and the re-check passes, the unit is tomorrow's.
    state.due_date = local_day() + timedelta(days=1)
    state.intraday_step_pending = False
    state.intraday_due_at = None
    db_session.commit()
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
    _rate(db_session, review_session, state, "encounter-hard", "rating-hard", 1)
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
    state.due_date = local_day()
    state.stage_index = 1
    state.has_passed = True
    # A new due cycle starts with no same-day ladder left over from the pass.
    state.intraday_due_at = None
    state.intraday_day = None
    state.intraday_retries = 0
    state.intraday_step_pending = False
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
    assert state.due_date > local_day()


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
    # 轻松 replaces the grade inside the same encounter and skips the same-day
    # re-check, booking three days instead of 记得's one-day step.
    assert state.due_date == local_day() + timedelta(days=3)
    assert state.intraday_step_pending is False
    assert state.stage_index >= 1
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


def test_rate_with_empty_session_id_opens_the_glance_inline(db_session):
    state = _seed_review_unit(db_session)

    rated = rate_review_unit(
        db_session,
        study_session_id="",
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-never-started",
        operation_id="rating-no-session",
        rating=3,
        round_id="round-2026-07-27",
    )

    assert rated["rating"] == 3
    assert rated["study_session_id"]
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


def test_failed_close_keeps_session_and_next_encounter_retains_penalty(db_session):
    state = _seed_review_unit(db_session)
    first = _start(db_session, state, "encounter-hard")
    _rate(db_session, first, state, "encounter-hard", "rating-hard", 1)
    assert state.intraday_retries == 1, (state.intraday_retries, state.intraday_step_pending)
    closed = close_unit_review_encounter(
        db_session,
        study_session_id=first["id"],
        unit_id=state.id,
        encounter_id="encounter-hard",
        operation_id="close-hard",
    )
    assert closed["passed"] is False
    assert closed["session_status"] == "active"

    # The retry is served after its wait, not immediately.
    state.intraday_due_at = utc_now_naive() - timedelta(minutes=1)
    db_session.commit()
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
    assert remembered["unit"]["stage_index"] >= 1
    # 重练通过 → 直接排明天，由隔夜检验确认；不再叠一次 20 分钟复查。
    assert remembered["intraday_kind"] is None
    assert remembered["retry_after_minutes"] is None
    assert remembered["unit"]["due_date"] == (local_day() + timedelta(days=1)).isoformat()


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

    close_response = client.post(
        f"/api/v1/review/session/{review_session['id']}/units/{unit_id}"
        "/encounters/http-encounter/close",
        json={"operation_id": "http-close-ignores-duration", "effective_seconds": 11},
    )
    assert close_response.status_code == 200
    assert close_response.json()["item"]["encounter"]["status"] == "closed"
    assert "effective_seconds" not in close_response.json()["item"]["encounter"]
    assert "duration_seconds" not in close_response.json()["item"]["completion"]

    replay_response = client.post(
        f"/api/v1/review/session/{review_session['id']}/units/{unit_id}"
        "/encounters/http-encounter/close",
        json={"operation_id": "http-close", "effective_seconds": 9},
    )
    assert replay_response.status_code == 200
    assert replay_response.json()["item"]["encounter"]["status"] == "closed"


@pytest.mark.parametrize("early", [False, True])
@pytest.mark.parametrize("first_rating", [1])
@pytest.mark.parametrize("passing_rating", [3, 4])
def test_real_retry_preserves_failure_and_preview_matches_commit(
    db_session, early, first_rating, passing_rating,
):
    from memory_anki.modules.memory.application.unit_scheduler import rate_unit

    state = _seed_review_unit(db_session)
    state.stage_index = 7
    state.has_passed = True
    state.due_date = local_day() + timedelta(days=14 if early else 0)
    db_session.commit()
    first = start_freestyle_unit_review_session(
        db_session, unit_id=state.id, unit_revision=state.revision,
        encounter_id="real-source", round_id="real-round", card_id="source",
        allow_not_due=early,
    )
    failed = _rate(db_session, first, state, "real-source", "real-fail", first_rating)
    lowered = failed["unit"]["stage_index"]
    fsrs_after_failure = _fsrs_state(state)
    # The same-day wait is real: simulate it elapsing before the retry is served.
    state.intraday_due_at = utc_now_naive() - timedelta(minutes=1)
    db_session.commit()
    intraday_after_failure = IntradayState(
        day=local_day(),
        due_at=state.intraday_due_at,
        retries=int(state.intraday_retries or 0),
        step_pending=False,
    )
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
    # Replay from the FSRS card the failure stored (before this pass): the retry
    # must land on exactly the date the preview promised.
    expected = rate_unit(
        stage_index=lowered, has_passed=True, rating=passing_rating,
        had_failure_in_encounter=True, today=local_day(), fuzz_key=state.id,
        fsrs_state=fsrs_after_failure,
        intraday=intraday_after_failure,
        # The commit path books from the due date the learner sees; after a
        # failure that is today, which puts the recovery on the fixed early
        # ladder (one day) instead of an FSRS estimate. The counter decides
        # whether the recovery is still inside that ladder.
        booked_due_date=local_day(),
        early_step=state.early_step,
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
    assert (item.again_count, item.hard_count) == (1, 0)
    from memory_anki.modules.memory.application.unit_review_service import get_unit_review_session

    historical = get_unit_review_session(db_session, first['id'], encounter_id='real-source')
    assert historical['units'][0]['encounter']['id'] == 'real-source'
    assert historical['units'][0]['encounter']['rating_editable'] is False
    with pytest.raises(ValueError, match="后续真实练习"):
        undo_unit_rating(db_session, "real-fail")
    # Swipe-back still opens the older card (the map needs a session), but the
    # glance is a read-only echo; only the write is refused.
    close_unit_review_encounter(
        db_session, study_session_id=retry["id"], unit_id=state.id,
        encounter_id="real-retry", operation_id="real-retry-close",
    )
    revisit = start_freestyle_unit_review_session(
        db_session, unit_id=state.id, unit_revision=state.revision,
        encounter_id="source-revisit", round_id="real-round", card_id="source",
    )
    revisit_encounter = revisit["units"][0]["encounter"]
    assert revisit_encounter["id"] == "source-revisit"
    assert revisit_encounter["rating_editable"] is False
    with pytest.raises(ValueError, match="后续真实练习"):
        rate_review_unit(
            db_session,
            study_session_id=revisit["id"],
            unit_id=state.id,
            unit_revision=state.revision,
            encounter_id="source-revisit",
            operation_id="source-revisit-rate",
            rating=4,
            round_id="real-round",
            card_id="source",
        )
    assert state.stage_index == expected.stage_index
    undo_unit_rating(db_session, "real-pass")
    assert state.stage_index == lowered
    assert state.due_date == local_day()
    assert item.retry_count == 1


def test_retry_slot_repeated_failures_and_correction(db_session):
    state = _seed_review_unit(db_session)
    state.stage_index = 7
    state.has_passed = True
    db_session.commit()
    first = _start(db_session, state, "source")
    _rate(db_session, first, state, "source", "source-forget", 1)
    assert state.stage_index == 0
    for attempt in (1, 2):
        retry = _start(
            db_session, state, f"retry-{attempt}", card_id="same-slot",
            occurrence_id="same-slot", retry_attempt=attempt,
        )
        _rate(db_session, retry, state, f"retry-{attempt}", f"forget-{attempt}", 1)
        # 忘记 is the only failing grade; repeated retries hold the unit at 0.
        assert state.stage_index == 0
    corrected = _rate(db_session, retry, state, "retry-2", "correct-last", 3)
    assert corrected["amended"] is True
    # A retry that finally passes books tomorrow directly: the overnight check
    # is the confirmation, and no same-day re-check is stacked on top.
    assert state.has_passed is True
    assert state.due_date == local_day() + timedelta(days=1)
    assert state.intraday_step_pending is False
    item = db_session.query(ReviewSessionUnit).filter_by(study_session_id=retry["id"]).one()
    assert item.retry_count == 2
    assert (item.again_count, item.hard_count) == (2, 0)
    assert db_session.get(ReviewUnitRatingOperation, "forget-2").replaced_at is not None
    assert db_session.get(ReviewUnitRatingOperation, "forget-1").replaced_at is None
    undo_unit_rating(db_session, "correct-last")
    assert state.stage_index == 0
    assert item.retry_count == 3


def test_same_attempt_revisit_correction_uses_preview_baseline(db_session):
    state = _seed_review_unit(db_session)
    state.stage_index = 7
    state.has_passed = True
    db_session.commit()
    first = _start(db_session, state, "source")
    _rate(db_session, first, state, "source", "source-forget", 1)
    close_unit_review_encounter(
        db_session, study_session_id=first["id"], unit_id=state.id,
        encounter_id="source", operation_id="source-close",
    )
    revisit = _start(db_session, state, "source-revisit")
    effect = next(x for x in revisit["units"][0]["encounter"]["rating_effects"] if x["rating"] == 3)
    corrected = _rate(db_session, revisit, state, "source-revisit", "source-corrected", 3)
    assert corrected["amended"] is True
    assert state.has_passed is True
    # A pass after today's 忘记 books tomorrow directly (the overnight
    # confirmation), with no extra same-day re-check.
    assert state.due_date == local_day() + timedelta(days=1)
    assert state.intraday_step_pending is False
    assert effect["target_stage_index"] == state.stage_index
    assert effect["target_due_date"] == state.due_date.isoformat()
    assert effect["target_interval_days"] == (state.due_date - local_day()).days
    assert db_session.query(ReviewSessionUnit).one().retry_count == 0
    undo_unit_rating(db_session, "source-corrected")
    assert state.stage_index == 0
    assert db_session.query(ReviewSessionUnit).one().retry_count == 1


def test_freestyle_rating_adopts_live_revision_after_topology_edit(db_session):
    # A mind-map edit that changes the unit topology invalidates the open
    # freestyle session and bumps the unit revision. The card still carries the
    # old revision, so the rating must reopen at the live revision, not 400.
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-topology-drift")
    old_revision = int(state.revision)
    adjust_unit_schedule(
        db_session,
        unit_id=state.id,
        operation_id="topology-edit-during-card",
        stage_index=state.stage_index,
    )
    db_session.commit()
    db_session.refresh(state)
    assert int(state.revision) != old_revision

    rated = rate_review_unit(
        db_session,
        study_session_id=review_session["id"],
        unit_id=state.id,
        unit_revision=old_revision,
        encounter_id="encounter-topology-drift",
        operation_id="rate-after-topology-edit",
        rating=2,
        round_id="round-2026-07-27",
        adopt_live_revision=True,
    )

    operation = db_session.get(ReviewUnitRatingOperation, "rate-after-topology-edit")
    assert operation is not None
    assert operation.unit_revision == int(state.revision)
    assert rated["encounter"]["selected_rating"] == 2
    assert rated["encounter"]["round_id"] == "round-2026-07-27"


def test_freestyle_rating_accepts_the_rebuilt_card_id_of_the_same_attempt(db_session):
    # 进入编辑 → 修改 → 返回学习 bumps the unit revision. The glance then reopens
    # at the live revision with the card id the learner still had (r1), while the
    # rebuilt feed taps the same unit as r4. The attempt identity compared the raw
    # card ids and rejected that tap with "rating attempt identity mismatch"; the
    # learner had to rate a second time. The attempt is the unit, not its revision.
    state = _seed_review_unit(db_session)
    old_card = f"review_unit:{state.id}:r{state.revision}"
    opened = _start(db_session, state, "encounter-revision-identity", card_id=old_card)
    old_revision = int(state.revision)
    adjust_unit_schedule(
        db_session,
        unit_id=state.id,
        operation_id="inline-edit-during-card",
        stage_index=state.stage_index,
    )
    db_session.commit()
    db_session.refresh(state)
    new_card = f"review_unit:{state.id}:r{state.revision}"
    assert new_card != old_card

    # The card's session reload after the edit still names the old card.
    _start(db_session, state, "encounter-revision-identity", card_id=old_card)

    rated = rate_review_unit(
        db_session,
        study_session_id=opened["id"],
        unit_id=state.id,
        unit_revision=old_revision,
        encounter_id="encounter-revision-identity",
        operation_id="rate-after-inline-edit",
        rating=3,
        round_id="round-2026-07-27",
        card_id=new_card,
        adopt_live_revision=True,
    )

    assert rated["encounter"]["selected_rating"] == 3
    operation = db_session.get(ReviewUnitRatingOperation, "rate-after-inline-edit")
    assert operation is not None
    assert operation.unit_revision == int(state.revision)


def test_freestyle_rating_accepts_the_base_card_after_a_retry_occurrence_was_replanned(db_session):
    # The plan can cancel a pending 重练 occurrence and put the unit back on the
    # rail as its base card. The glance opened for the retry stayed live, so the
    # learner's tap named review_unit:<unit>:rN while the glance held
    # retry:<round>:<unit>:1. The strict comparison rejected every tap with
    # "rating attempt identity mismatch" — 未保存 could never be saved. Both ids
    # name the same unit's unrated work in the same round.
    state = _seed_review_unit(db_session)
    retry_id = f"retry:round-2026-07-27:{state.id}:1"
    opened = _start(
        db_session, state, "encounter-retry-identity",
        card_id=retry_id, occurrence_id=retry_id, retry_attempt=1,
    )
    base_card = f"review_unit:{state.id}:r{state.revision}"

    rated = rate_review_unit(
        db_session,
        study_session_id=opened["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id="encounter-retry-identity",
        operation_id="rate-base-card-after-replanned-retry",
        rating=3,
        round_id="round-2026-07-27",
        card_id=base_card,
    )

    assert rated["encounter"]["selected_rating"] == 3
    encounter = db_session.get(ReviewUnitEncounter, "encounter-retry-identity")
    assert json.loads(encounter.baseline_state_json)["attempt_identity"]["card_id"] == (
        f"review_unit:{state.id}"
    )


def test_freestyle_rating_still_rejects_another_units_attempt(db_session):
    state = _seed_review_unit(db_session)
    opened = _start(db_session, state, "encounter-foreign-identity",
                    card_id=f"review_unit:{state.id}:r{state.revision}")

    with pytest.raises(ValueError, match="rating attempt identity mismatch"):
        rate_review_unit(
            db_session,
            study_session_id=opened["id"],
            unit_id=state.id,
            unit_revision=state.revision,
            encounter_id="encounter-foreign-identity",
            operation_id="rate-foreign-attempt",
            rating=3,
            round_id="round-2026-07-27",
            card_id="review_unit:a-different-unit:r1",
        )


def test_freestyle_start_follows_successor_after_structural_retire(db_session):
    # Reconcile retires a unit and may create its successor under a new id with the
    # same palace + anchor. A card still holding the retired id must start the
    # successor instead of failing with "review unit not found".
    state = _seed_review_unit(db_session)
    retired_id = state.id
    state.active = False
    db_session.commit()
    successor = ReviewUnitState(
        id="successor-after-retire",
        palace_id=state.palace_id,
        anchor_uid=state.anchor_uid,
        unit_kind=state.unit_kind,
        node_uids_json=state.node_uids_json,
        membership_hash=state.membership_hash,
        content_hash=state.content_hash,
        revision=1,
        stage_index=state.stage_index,
        has_passed=state.has_passed,
        due_date=state.due_date,
        topology_order=state.topology_order,
        active=True,
    )
    db_session.add(successor)
    db_session.commit()

    review_session = start_freestyle_unit_review_session(
        db_session,
        unit_id=retired_id,
        unit_revision=1,
        encounter_id="encounter-successor",
        round_id="round-2026-07-27",
        client_source="desktop",
        card_id="source-card",
    )

    assert review_session["units"][0]["id"] == successor.id


def test_rating_still_rejects_stale_revision_without_adoption(db_session):
    state = _seed_review_unit(db_session)
    review_session = _start(db_session, state, "encounter-strict")
    old_revision = int(state.revision)
    state.revision = old_revision + 1
    db_session.commit()

    with pytest.raises(ValueError, match="review unit changed"):
        rate_review_unit(
            db_session,
            study_session_id=review_session["id"],
            unit_id=state.id,
            unit_revision=old_revision,
            encounter_id="encounter-strict",
            operation_id="rate-strict",
            rating=3,
            round_id="round-2026-07-27",
        )


def test_freestyle_start_that_loses_the_open_glance_race_returns_the_winner(db_session, test_engine):
    """Two starts for one unit can both pass the `existing` check; the partial unique
    index admits one open glance. The loser must hand back the winner's glance instead
    of failing the card with a 500 (seen in production as UNIQUE on
    review_unit_encounters open index)."""
    from sqlalchemy import event
    from sqlalchemy.orm import sessionmaker

    from memory_anki.modules.memory.application.unit_review_service import ENCOUNTER_OPEN

    state = _seed_review_unit(db_session)
    fired: list[str] = []

    def _competitor_wins_first(session, _flush_context, _instances):
        if fired:
            return
        pending = [obj for obj in session.new if isinstance(obj, ReviewUnitEncounter)]
        if not pending:
            return
        fired.append("yes")
        racing = pending[0]
        with sessionmaker(bind=test_engine)() as other:
            other.add(
                ReviewUnitEncounter(
                    id="encounter-winner",
                    study_session_id=racing.study_session_id,
                    unit_id=racing.unit_id,
                    unit_revision=racing.unit_revision,
                    round_id=racing.round_id,
                    sequence=7,
                    baseline_state_json=racing.baseline_state_json,
                    status=ENCOUNTER_OPEN,
                )
            )
            other.commit()

    event.listen(db_session, "before_flush", _competitor_wins_first)
    try:
        resumed = _start(db_session, state, "encounter-loser")
    finally:
        event.remove(db_session, "before_flush", _competitor_wins_first)

    assert fired, "the race was not reached; the test no longer exercises the insert path"
    assert resumed["units"][0]["encounter"]["id"] == "encounter-winner"
    open_rows = (
        db_session.query(ReviewUnitEncounter)
        .filter_by(unit_id=state.id, status=ENCOUNTER_OPEN)
        .all()
    )
    assert [row.id for row in open_rows] == ["encounter-winner"]


def test_reopening_a_superseded_attempt_opens_a_read_only_glance(session_factory, make_client):
    """A card the learner already rated, then re-practiced, reopens for reading only.

    The feed keeps answered cards so swipe-back can review them, and the map only
    renders from a session start. A 400 here left the card blank and its tap stuck
    on 未保存 forever, so the glance opens and reports `rating_editable: false`;
    the write is still refused with the machine-readable code the client stops on.
    """
    from memory_anki.modules.memory.presentation import router as review_router

    with session_factory() as session:
        state = _seed_review_unit(session)
        unit_id = state.id
        revision = state.revision
        first = _start(session, state, "sup-source", card_id="source")
        _rate(session, first, state, "sup-source", "sup-fail", 2)
        close_unit_review_encounter(
            session,
            study_session_id=first["id"],
            unit_id=unit_id,
            encounter_id="sup-source",
            operation_id="sup-close",
        )
        later = _start(session, state, "sup-later", card_id="later-slot")
        _rate(session, later, state, "sup-later", "sup-pass", 3)
        close_unit_review_encounter(
            session,
            study_session_id=later["id"],
            unit_id=unit_id,
            encounter_id="sup-later",
            operation_id="sup-later-close",
        )

    client = make_client(review_router)
    response = client.post(
        f"/api/v1/review/units/{unit_id}/sessions",
        json={
            "unit_revision": revision,
            "round_id": "round-2026-07-27",
            "encounter_id": "sup-revisit",
            "card_id": "source",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()["item"]
    unit = next(item for item in payload["units"] if item["id"] == unit_id)
    assert unit["encounter"]["id"] == "sup-revisit"
    assert unit["encounter"]["rating_editable"] is False

    blocked = client.post(
        f"/api/v1/review/session/{payload['id']}/units/{unit_id}/ratings",
        json={
            "unit_revision": revision,
            "encounter_id": "sup-revisit",
            "operation_id": "sup-revisit-rating",
            "rating": 3,
            "round_id": "round-2026-07-27",
        },
    )
    assert blocked.status_code == 400, blocked.text
    detail = blocked.json()["detail"]
    assert detail["code"] == "superseded_attempt"
    assert "后续真实练习" in detail["message"]


def test_attempt_identity_ignores_revision_and_retry_counter_drift():
    # Same review work at a new content revision, and the same retry occurrence
    # after the plan advanced its counter: both are the attempt the learner is
    # looking at. Different units / occurrences stay different attempts.
    source = {"card_id": "review_unit:u:r1", "occurrence_id": "", "retry_attempt": 0}
    assert attempt_identity_matches(source, {**source, "card_id": "review_unit:u:r9"})
    assert not attempt_identity_matches(source, {**source, "card_id": "review_unit:v:r1"})

    retry = {"card_id": "retry:r:abc", "occurrence_id": "retry:r:abc", "retry_attempt": 1}
    # A new retry attempt is a different attempt, even on the same source.
    assert not attempt_identity_matches(retry, {**retry, "retry_attempt": 2})
    assert not attempt_identity_matches(retry, {
        **retry, "card_id": "retry:r:def", "occurrence_id": "retry:r:def",
    })
