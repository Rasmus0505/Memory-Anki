"""API tests for the read-only freestyle start-page overview."""

from __future__ import annotations

import json
from datetime import date, datetime

from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace, palace_subject_table
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.unit_reconcile import reconcile_palace_units
from memory_anki.modules.practice.application.freestyle_overview import _round_block
from memory_anki.modules.practice.presentation import router as freestyle_router

OVERVIEW = "/api/v1/freestyle/overview"
DAY = "2026-10-12"


def _palace(session, title: str) -> int:
    palace = Palace(
        title=title,
        exam_stars=3,
        exam_stars_source="manual",
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": f"{title}-root", "text": title, "permanentSplitMark": True},
                    "children": [
                        {"data": {"uid": f"{title}-branch", "text": "branch"}, "children": []}
                    ],
                }
            }
        ),
    )
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    return palace.id


def _units(session, palace_id: int) -> list[ReviewUnitState]:
    return (
        session.query(ReviewUnitState)
        .filter(ReviewUnitState.palace_id == palace_id)
        .order_by(ReviewUnitState.id)
        .all()
    )


def _set_due(session, palace_id: int, due: date) -> None:
    for row in _units(session, palace_id):
        row.due_date = due
    session.commit()


def _seed_ratings(session, rows: list[tuple[ReviewUnitState, int, datetime]]) -> None:
    session.add(StudySession(id="ss-overview", scene="freestyle", started_at=datetime(2026, 10, 1)))
    session.flush()
    for index, (unit, rating, created_at) in enumerate(rows, start=1):
        encounter_id = f"enc-{index}"
        session.add(
            ReviewUnitEncounter(
                id=encounter_id,
                study_session_id="ss-overview",
                unit_id=unit.id,
                unit_revision=1,
                round_id="round-overview",
                sequence=index,
                baseline_state_json="{}",
                status="closed",
                created_at=created_at,
            )
        )
        session.add(
            ReviewUnitRatingOperation(
                id=f"op-{index}",
                encounter_id=encounter_id,
                study_session_id="ss-overview",
                unit_id=unit.id,
                palace_id=unit.palace_id,
                unit_revision=1,
                rating=rating,
                passed=rating != 1,
                retry_after_cards=0,
                before_state_json="{}",
                after_state_json="{}",
                created_at=created_at,
            )
        )
    session.commit()


def test_today_counts_overdue_due_and_new_palaces(make_client, session_factory):
    client = make_client(freestyle_router)
    with session_factory() as session:
        overdue = _palace(session, "overdue")
        due_today = _palace(session, "due-today")
        later = _palace(session, "later")
        session.add(Palace(title="blank", editor_doc=""))
        session.commit()
        _set_due(session, overdue, date(2026, 10, 10))
        _set_due(session, due_today, date(2026, 10, 12))
        _set_due(session, later, date(2026, 10, 20))
        overdue_units = len(_units(session, overdue))
        due_units = len(_units(session, due_today))

    response = client.get(OVERVIEW, params={"date": DAY, "tz": "Asia/Shanghai"})

    assert response.status_code == 200, response.text
    assert response.json()["today"] == {
        "due_count": overdue_units + due_units,
        "overdue_count": overdue_units,
        "new_palace_count": 1,
    }


def test_next_reviews_are_future_only_sorted_and_named(make_client, session_factory):
    client = make_client(freestyle_router)
    with session_factory() as session:
        palace_id = _palace(session, "schedule")
        _set_due(session, palace_id, date(2026, 10, 12))
        units = _units(session, palace_id)
        units[0].due_date = date(2026, 10, 30)
        units[-1].due_date = date(2026, 10, 15)
        session.commit()

    response = client.get(OVERVIEW, params={"date": DAY, "tz": "Asia/Shanghai"})

    assert response.status_code == 200, response.text
    reviews = response.json()["next_reviews"]
    assert [item["due_date"] for item in reviews] == sorted(item["due_date"] for item in reviews)
    assert reviews, "units due after today must be listed"
    assert all(item["due_date"] > DAY for item in reviews)
    assert all(item["palace_name"] == "schedule" for item in reviews)
    assert all(isinstance(item["interval_days"], int) for item in reviews)


def test_yesterday_recap_uses_local_day_window_and_weak_ratio(make_client, session_factory):
    client = make_client(freestyle_router)
    with session_factory() as session:
        recap = _palace(session, "recap")
        boundary = _palace(session, "boundary")
        weak_unit = _units(session, recap)[0]
        edge_unit = _units(session, boundary)[0]
        _seed_ratings(
            session,
            [
                (weak_unit, 1, datetime(2026, 10, 11, 4, 0)),
                (weak_unit, 1, datetime(2026, 10, 11, 5, 0)),
                (weak_unit, 3, datetime(2026, 10, 11, 6, 0)),
                # Shanghai 23:30 on Oct 11 is still yesterday.
                (edge_unit, 1, datetime(2026, 10, 11, 15, 30)),
                # Shanghai 00:30 on Oct 12 is today, not yesterday.
                (edge_unit, 3, datetime(2026, 10, 11, 16, 30)),
            ],
        )
        edge_unit_id = edge_unit.id
        weak_unit_id = weak_unit.id

    response = client.get(OVERVIEW, params={"date": DAY, "tz": "Asia/Shanghai"})

    assert response.status_code == 200, response.text
    yesterday = response.json()["yesterday"]
    assert yesterday["date"] == "2026-10-11"
    assert yesterday["rated_count"] == 4
    assert yesterday["learned_units"] == 2
    assert [item["unit_id"] for item in yesterday["weak_units"]] == [edge_unit_id, weak_unit_id]
    assert yesterday["weak_units"][0]["again_ratio"] == 1.0
    assert yesterday["weak_units"][1]["again_ratio"] == 0.67
    assert yesterday["weak_units"][1]["palace_name"] == "recap"


def test_round_is_null_without_round_id_or_for_unknown_round(make_client):
    client = make_client(freestyle_router)

    no_id = client.get(OVERVIEW, params={"date": DAY, "tz": "Asia/Shanghai"})
    unknown = client.get(
        OVERVIEW,
        params={"date": DAY, "tz": "Asia/Shanghai", "round_id": "missing-round"},
    )

    assert no_id.json()["round"] is None
    assert unknown.json()["round"] is None


def test_overview_is_read_only(make_client, session_factory):
    client = make_client(freestyle_router)
    with session_factory() as session:
        palace_id = _palace(session, "readonly")
        _set_due(session, palace_id, date(2026, 10, 10))
        before = [(row.id, row.due_date, row.revision) for row in _units(session, palace_id)]

    client.get(OVERVIEW, params={"date": DAY, "tz": "Asia/Shanghai"})

    with session_factory() as session:
        after = [(row.id, row.due_date, row.revision) for row in _units(session, palace_id)]
    assert after == before


def test_rejects_invalid_timezone_and_date(make_client):
    client = make_client(freestyle_router)

    bad_tz = client.get(OVERVIEW, params={"date": DAY, "tz": "Not/AZone"})
    bad_date = client.get(OVERVIEW, params={"date": "2026-13-01", "tz": "Asia/Shanghai"})

    assert bad_tz.status_code == 400
    assert bad_date.status_code == 400


def test_round_block_counts_done_excluded_and_subjects(session_factory):
    with session_factory() as session:
        palace_id = _palace(session, "subject-palace")
        subject = Subject(name="数学", color="#000000", sort_order=2)
        session.add(subject)
        session.commit()
        subject_id = subject.id
        session.execute(
            palace_subject_table.insert().values(palace_id=palace_id, subject_id=subject_id)
        )
        session.commit()
        unit = _units(session, palace_id)[0]
        payload = {
            "round_id": "round-x",
            "version": 4,
            "plan": {
                "original_cards": [
                    {"card_id": "c1", "palace_id": palace_id, "unit_id": unit.id},
                    {"card_id": "c2", "palace_id": palace_id, "unit_id": unit.id},
                    {"card_id": "c3", "palace_id": palace_id, "unit_id": None},
                    {"card_id": "c4", "palace_id": palace_id, "unit_id": unit.id},
                ],
                "completed_ids": ["c1"],
                "excluded_ids": ["c4"],
            },
        }
        block = _round_block(session, payload)
        expected_new = 0 if unit.has_passed else 1

    assert block["round_id"] == "round-x"
    assert block["version"] == 4
    assert block["counts"] == {
        "palaces": 1,
        "units": 1,
        "new": expected_new,
        "review": 1 - expected_new,
        "done": 1,
        "remaining": 2,
    }
    assert block["by_subject"] == [
        {"subject_id": subject_id, "name": "数学", "done": 1, "total": 3}
    ]
