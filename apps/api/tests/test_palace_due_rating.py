import json
from datetime import date, timedelta

import pytest

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.unit_review_service import (
    rate_palace_due_units,
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
    undo_unit_rating,
)


def _editor_doc() -> str:
    return json.dumps(
        {
            "root": {
                "data": {
                    "uid": "root",
                    "text": "宫殿整体评分",
                    "permanentSplitMark": True,
                },
                "children": [
                    {
                        "data": {
                            "uid": "node-a",
                            "text": "小节 A",
                            "permanentSplitMark": True,
                        },
                        "children": [],
                    },
                    {
                        "data": {
                            "uid": "node-b",
                            "text": "小节 B",
                            "permanentSplitMark": True,
                        },
                        "children": [],
                    },
                ],
            }
        },
        ensure_ascii=False,
    )


def _seed_palace(session) -> tuple[Palace, list[ReviewUnitState]]:
    palace = Palace(title="宫殿整体评分", archived=False, editor_doc=_editor_doc())
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    units = (
        session.query(ReviewUnitState)
        .filter_by(palace_id=palace.id, active=True)
        .order_by(ReviewUnitState.anchor_uid.asc())
        .all()
    )
    assert len(units) >= 2
    return palace, units


def _open(session, state: ReviewUnitState, encounter_id: str, *, allow_not_due: bool = False):
    return start_freestyle_unit_review_session(
        session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        round_id="round-palace",
        allow_not_due=allow_not_due,
    )


def _current(review_session: dict, state: ReviewUnitState, encounter_id: str) -> dict:
    return {
        "study_session_id": review_session["id"],
        "unit_id": state.id,
        "unit_revision": state.revision,
        "encounter_id": encounter_id,
    }


def test_palace_due_rating_scores_every_due_unit(db_session):
    palace, units = _seed_palace(db_session)
    current = units[0]
    opened = _open(db_session, current, "enc-current")

    result = rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-pass",
        rating=3,
        round_id="round-palace",
        current=_current(opened, current, "enc-current"),
    )

    assert result["batch_id"] == "batch-pass"
    assert set(result["rated_unit_ids"]) == {unit.id for unit in units}
    assert result["remaining_due_count"] == 0
    assert result["current"]["passed"] is True
    assert result["current"]["encounter"]["id"] == "enc-current"
    for unit in units:
        db_session.refresh(unit)
        assert unit.has_passed is True
        assert unit.due_date > date.today()
    current_study = db_session.get(StudySession, opened["id"])
    assert current_study.status == "active"
    assert db_session.get(ReviewUnitEncounter, "enc-current").status == "open"


def test_palace_due_rating_skips_already_rated_and_excluded_units(db_session):
    palace, units = _seed_palace(db_session)
    kept, current, *rest = units
    first = _open(db_session, kept, "enc-kept")
    rate_review_unit(
        db_session,
        study_session_id=first["id"],
        unit_id=kept.id,
        unit_revision=kept.revision,
        encounter_id="enc-kept",
        operation_id="rate-kept",
        rating=4,
        round_id="round-palace",
    )
    opened = _open(db_session, current, "enc-current")
    before_kept_due = kept.due_date
    before_kept_stage = kept.stage_index

    result = rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-skip",
        rating=3,
        round_id="round-palace",
        current=_current(opened, current, "enc-current"),
        exclude_unit_ids=[unit.id for unit in rest],
    )

    assert kept.id not in result["rated_unit_ids"]
    assert all(unit.id not in result["rated_unit_ids"] for unit in rest)
    assert current.id in result["rated_unit_ids"]
    db_session.refresh(kept)
    assert kept.due_date == before_kept_due
    assert kept.stage_index == before_kept_stage


def test_palace_due_rating_includes_current_fill_without_moving_it(db_session):
    palace, units = _seed_palace(db_session)
    current = units[0]
    siblings = units[1:]
    current.due_date = date.today() + timedelta(days=5)
    db_session.commit()
    opened = _open(db_session, current, "enc-fill", allow_not_due=True)

    result = rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-fill",
        rating=3,
        round_id="round-palace",
        current=_current(opened, current, "enc-fill"),
    )

    assert current.id in result["rated_unit_ids"]
    assert result["current"]["schedule_changed"] is False
    db_session.refresh(current)
    assert current.due_date == date.today() + timedelta(days=5)
    for unit in siblings:
        db_session.refresh(unit)
        assert unit.has_passed is True
        assert unit.due_date > date.today()


def test_palace_due_rating_again_keeps_units_due(db_session):
    palace, units = _seed_palace(db_session)
    current = units[0]
    opened = _open(db_session, current, "enc-again")

    result = rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-again",
        rating=1,
        round_id="round-palace",
        current=_current(opened, current, "enc-again"),
    )

    assert result["remaining_due_count"] == len(units)
    assert result["current"]["passed"] is False
    assert result["current"]["retry_after_cards"] == 3
    for item in result["items"]:
        assert item["passed"] is False
        db_session.refresh(db_session.get(ReviewUnitState, item["unit"]["id"]))
        assert db_session.get(ReviewUnitState, item["unit"]["id"]).due_date == date.today()


def test_palace_due_rating_undo_restores_the_batch(db_session):
    palace, units = _seed_palace(db_session)
    current = units[0]
    opened = _open(db_session, current, "enc-undo")
    snapshots = {
        unit.id: (unit.stage_index, unit.due_date, unit.has_passed) for unit in units
    }

    rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-undo",
        rating=3,
        round_id="round-palace",
        current=_current(opened, current, "enc-undo"),
    )
    undone = undo_unit_rating(db_session, "batch-undo", "round-palace")

    assert undone["batch_id"] == "batch-undo"
    assert set(undone["undone_unit_ids"]) == {unit.id for unit in units}
    assert undone["encounter"]["selected_rating"] is None
    for unit in units:
        db_session.refresh(unit)
        assert (unit.stage_index, unit.due_date, unit.has_passed) == snapshots[unit.id]


def test_palace_due_rating_is_idempotent(db_session):
    palace, units = _seed_palace(db_session)
    current = units[0]
    opened = _open(db_session, current, "enc-idem")
    first = rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-idem",
        rating=3,
        round_id="round-palace",
        current=_current(opened, current, "enc-idem"),
    )
    second = rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-idem",
        rating=3,
        round_id="round-palace",
        current=_current(opened, current, "enc-idem"),
    )

    assert second["batch_id"] == first["batch_id"]
    assert second["rated_unit_ids"] == first["rated_unit_ids"]
    assert db_session.query(ReviewUnitRatingOperation).filter_by(batch_id="batch-idem").count() == len(units)


def test_palace_due_rating_rejects_stale_current_revision(db_session):
    palace, units = _seed_palace(db_session)
    current = units[0]
    opened = _open(db_session, current, "enc-stale")
    payload = _current(opened, current, "enc-stale")
    payload["unit_revision"] = current.revision + 1

    with pytest.raises(ValueError, match="review unit changed"):
        rate_palace_due_units(
            db_session,
            palace_id=palace.id,
            operation_id="batch-stale",
            rating=3,
            round_id="round-palace",
            current=payload,
        )

    assert db_session.query(ReviewUnitRatingOperation).filter_by(batch_id="batch-stale").count() == 0
    for unit in units:
        db_session.refresh(unit)
        assert unit.has_passed is False
        assert unit.due_date <= date.today()


def test_palace_due_rating_includes_explicit_not_due_siblings(db_session):
    palace, units = _seed_palace(db_session)
    current = units[0]
    fill = units[1]
    fill.due_date = date.today() + timedelta(days=9)
    db_session.commit()
    opened = _open(db_session, current, "enc-include")

    result = rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-include",
        rating=3,
        round_id="round-palace",
        current=_current(opened, current, "enc-include"),
        include_unit_ids=[fill.id],
    )

    assert fill.id in result["rated_unit_ids"]
    fill_item = next(item for item in result["items"] if item["unit"]["id"] == fill.id)
    assert fill_item["schedule_changed"] is False
    db_session.refresh(fill)
    assert fill.due_date == date.today() + timedelta(days=9)


def test_palace_due_rating_does_not_move_non_due_siblings(db_session):
    palace, units = _seed_palace(db_session)
    current = units[0]
    future = units[1]
    future.due_date = date.today() + timedelta(days=9)
    db_session.commit()
    opened = _open(db_session, current, "enc-future")

    result = rate_palace_due_units(
        db_session,
        palace_id=palace.id,
        operation_id="batch-future",
        rating=4,
        round_id="round-palace",
        current=_current(opened, current, "enc-future"),
    )

    assert future.id not in result["rated_unit_ids"]
    db_session.refresh(future)
    assert future.due_date == date.today() + timedelta(days=9)
    assert future.has_passed is False
