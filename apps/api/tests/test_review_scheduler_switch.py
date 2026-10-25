"""The one-time switch that makes FSRS the production palace scheduler."""

from __future__ import annotations

import json
from datetime import timedelta

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.review_scheduler_switch import (
    MARKER_KEY,
    backfill_fsrs_scheduler,
)
from memory_anki.modules.memory.application.unit_fsrs_adapter import SCHEDULER_VERSION
from memory_anki.modules.memory.application.unit_review_service import (
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
)


def _seed_unit(session, *, title: str = "切换测试宫殿") -> ReviewUnitState:
    palace = Palace(
        title=title,
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": title, "permanentSplitMark": True},
                    "children": [
                        {"data": {"uid": "node-a", "text": "节点 A"}, "children": []}
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


def _rate_once(session, state: ReviewUnitState, *, encounter: str, operation: str, rating: int = 3):
    review = start_freestyle_unit_review_session(
        session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter,
        round_id="round-switch",
        client_source="desktop",
    )
    rate_review_unit(
        session,
        study_session_id=review["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter,
        operation_id=operation,
        rating=rating,
    )
    session.commit()
    session.refresh(state)


def _as_pre_switch(session, state: ReviewUnitState, *, stage_index: int = 5) -> None:
    """Rewind the row to what a pre-FSRS collection looks like."""
    state.fsrs_stability = None
    state.fsrs_difficulty = None
    state.fsrs_state = None
    state.fsrs_step = None
    state.fsrs_due_at = None
    state.fsrs_last_review = None
    state.fsrs_scheduler_version = None
    state.stage_index = stage_index
    state.has_passed = True
    state.due_date = local_day() + timedelta(days=30)
    session.commit()


def test_dry_run_reports_without_writing_any_state(db_session):
    state = _seed_unit(db_session)
    _rate_once(db_session, state, encounter="enc-dry", operation="op-dry")
    _as_pre_switch(db_session, state)

    summary = backfill_fsrs_scheduler(db_session, dry_run=True)

    assert summary["dry_run"] is True
    assert summary["units"] == 1
    assert summary["with_history"] == 1
    assert summary["operations"] == 1
    db_session.refresh(state)
    assert state.fsrs_scheduler_version is None
    assert state.stage_index == 5
    assert db_session.query(Config).filter(Config.key == MARKER_KEY).one_or_none() is None


def test_backfill_writes_fsrs_state_and_due_date_once(db_session):
    state = _seed_unit(db_session)
    _rate_once(db_session, state, encounter="enc-write", operation="op-write")
    _as_pre_switch(db_session, state)
    backups: list[str] = []

    summary = backfill_fsrs_scheduler(db_session, backup=backups.append)
    db_session.commit()

    assert backups == ["pre-fsrs-switch"]
    assert summary["with_history"] == 1
    assert summary["changed_due"] == 1
    assert summary["samples"][0]["unit_id"] == state.id

    db_session.refresh(state)
    assert state.fsrs_scheduler_version == SCHEDULER_VERSION
    assert state.fsrs_stability is not None
    assert state.fsrs_difficulty is not None
    assert state.fsrs_due_at is not None
    assert state.fsrs_last_review is not None
    assert state.has_passed is True
    assert state.stage_index >= 1
    marker = db_session.query(Config).filter(Config.key == MARKER_KEY).one()
    assert marker.value == SCHEDULER_VERSION

    # The learner-visible due date is the product projection of the replay, not
    # the old ladder row: it must be a real booking from the rating day.
    operations = (
        db_session.query(ReviewUnitRatingOperation)
        .filter_by(unit_id=state.id)
        .order_by(ReviewUnitRatingOperation.created_at.asc())
        .all()
    )
    assert len(operations) == 1
    assert state.due_date >= operations[0].created_at.date()


def test_second_run_skips_units_already_on_the_current_scheduler(db_session):
    state = _seed_unit(db_session)
    _rate_once(db_session, state, encounter="enc-idem", operation="op-idem")
    _as_pre_switch(db_session, state)

    first = backfill_fsrs_scheduler(db_session)
    db_session.commit()
    assert first["with_history"] == 1

    second = backfill_fsrs_scheduler(db_session)
    assert second["skipped_already_current"] == 1
    assert second["with_history"] == 0


def test_units_without_history_are_left_at_their_legacy_position(db_session):
    state = _seed_unit(db_session)
    _as_pre_switch(db_session, state)

    summary = backfill_fsrs_scheduler(db_session)
    db_session.commit()

    assert summary["empty"] == 1
    assert summary["with_history"] == 0
    db_session.refresh(state)
    # A never-rated unit is a brand-new card and stays due on its booked day.
    assert state.fsrs_scheduler_version is None
    assert state.stage_index == 5


def test_mature_units_keep_their_earned_booking(db_session):
    """A second policy replay must not re-inflate a mature card.

    Only units still inside the fixed early ladder are replayed; a mature unit
    is stamped with the new policy version so the next startup skips it, and its
    card and due date stay exactly as earned.
    """
    from memory_anki.core.time import utc_now_naive

    state = _seed_unit(db_session)
    _rate_once(db_session, state, encounter="enc-mature", operation="op-mature")
    db_session.refresh(state)
    state.fsrs_last_review = utc_now_naive() - timedelta(days=30)
    state.due_date = local_day() + timedelta(days=14)
    state.fsrs_scheduler_version = "fsrs-6.3.1"
    earned_due = state.due_date
    earned_stability = state.fsrs_stability
    db_session.commit()

    summary = backfill_fsrs_scheduler(db_session)
    db_session.commit()

    assert summary["with_history"] == 0
    assert summary["kept_mature"] == 1
    db_session.refresh(state)
    assert state.due_date == earned_due
    assert state.fsrs_stability == earned_stability
    assert state.fsrs_scheduler_version == SCHEDULER_VERSION


def test_early_unit_gets_its_ladder_counter_without_moving_the_booking(db_session):
    """A policy change stamps the fixed-ladder position and keeps the promised date.

    The old repair re-derived a young unit's due date from its last rating. The
    counter now records where the unit is in the fixed rhythm, so the learner
    keeps the date already booked and only the *next* rating follows the new
    gaps.
    """
    from memory_anki.core.time import utc_now_naive

    state = _seed_unit(db_session)
    _rate_once(db_session, state, encounter="enc-early", operation="op-early")
    db_session.refresh(state)
    state.fsrs_last_review = utc_now_naive()
    state.stage_index = 2
    state.due_date = local_day() + timedelta(days=3)
    state.fsrs_scheduler_version = "fsrs-6.3.1"
    db_session.commit()

    summary = backfill_fsrs_scheduler(db_session)
    db_session.commit()

    assert summary["stamped_early"] == 1
    db_session.refresh(state)
    assert state.due_date == local_day() + timedelta(days=3)
    assert state.early_step == 2
    assert state.fsrs_scheduler_version == SCHEDULER_VERSION
