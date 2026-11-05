"""The learning city's "today island": one house per palace rated this study day."""

from __future__ import annotations

import json
from datetime import timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.dashboard.application.bounds import today_bounds
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.memory.application.unit_reconcile import reconcile_palace_units

URL = "/api/v1/dashboard/city-today"


def _palace(session, title: str) -> list[ReviewUnitState]:
    palace = Palace(
        title=title,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": f"{title}-root", "text": title},
                    "children": [
                        {"data": {"uid": f"{title}-{k}", "text": k, "permanentSplitMark": True}, "children": []}
                        for k in ("a", "b")
                    ],
                }
            }
        ),
    )
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    return session.query(ReviewUnitState).filter_by(palace_id=palace.id).order_by(ReviewUnitState.id).all()


def _rate(session, unit: ReviewUnitState, rating: int, created_at, *, undone: bool = False) -> None:
    index = session.query(ReviewUnitRatingOperation).count() + 1
    if not session.get(StudySession, "ss-city"):
        session.add(StudySession(id="ss-city", scene="freestyle", started_at=created_at))
        session.flush()
    session.add(
        ReviewUnitEncounter(
            id=f"enc-{index}", study_session_id="ss-city", unit_id=unit.id, unit_revision=1,
            sequence=index, round_id="round-city", baseline_state_json="{}", status="closed", created_at=created_at,
        )
    )
    session.add(
        ReviewUnitRatingOperation(
            id=f"op-{index}", encounter_id=f"enc-{index}", study_session_id="ss-city",
            unit_id=unit.id, palace_id=unit.palace_id, unit_revision=1, rating=rating,
            passed=rating >= 2, retry_after_cards=0, before_state_json="{}", after_state_json="{}",
            created_at=created_at, undone_at=created_at if undone else None,
        )
    )
    session.commit()


def test_empty_day_has_no_houses(make_client):
    body = make_client(dashboard_router).get(URL).json()

    assert body["palaces"] == []
    assert body["day"]


def test_houses_follow_first_rating_order_and_keep_latest_rating(make_client, session_factory):
    start, _end = today_bounds()
    with session_factory() as session:
        first = _palace(session, "First")
        second = _palace(session, "Second")
        _rate(session, second[0], 1, start - timedelta(hours=1))  # yesterday: not today's island
        _rate(session, second[0], 3, start + timedelta(minutes=1))
        _rate(session, first[0], 1, start + timedelta(minutes=2))
        _rate(session, first[0], 4, start + timedelta(minutes=3))
        _rate(session, first[1], 2, start + timedelta(minutes=4), undone=True)
        first_unit = first[0].id

    body = make_client(dashboard_router).get(URL).json()

    assert [p["title"] for p in body["palaces"]] == ["Second", "First"]
    house = body["palaces"][1]
    assert house["unit_count"] == 2
    assert house["rating_count"] == 2
    assert house["units"] == [{"id": first_unit, "rating": 4}]


def test_now_is_inside_today_bounds():
    start, end = today_bounds()
    assert start <= utc_now_naive() < end
