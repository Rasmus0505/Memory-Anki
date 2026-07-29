"""Ladder progress read model for the mindmap toolbar strip."""

from __future__ import annotations

import json
from datetime import date, timedelta

from memory_anki.core.time import local_calendar_day_start_as_utc_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitState,
)
from memory_anki.modules.memory.application.unit_ladder_progress import (
    get_palace_ladder_progress,
    resolve_range_start,
)
from memory_anki.modules.memory.application.unit_review_service import (
    close_unit_review_encounter,
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
)


def _seed_review_unit(session, *, title: str = "阶梯进度宫殿") -> ReviewUnitState:
    palace = Palace(
        title=title,
        archived=False,
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {
                        "uid": "root",
                        "text": title,
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


def _pass_once(
    session,
    state: ReviewUnitState,
    *,
    encounter_id: str,
    operation_id: str,
    rating: int = 3,
    elapsed_seconds: int = 0,
):
    review = start_freestyle_unit_review_session(
        session,
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        round_id="round-ladder",
        client_source="desktop",
    )
    rate_review_unit(
        session,
        study_session_id=review["id"],
        unit_id=state.id,
        unit_revision=state.revision,
        encounter_id=encounter_id,
        operation_id=operation_id,
        rating=rating,
    )
    close_unit_review_encounter(
        session,
        study_session_id=review["id"],
        unit_id=state.id,
        encounter_id=encounter_id,
        operation_id=f"close-{operation_id}",
    )
    encounter = session.get(ReviewUnitEncounter, encounter_id)
    if encounter is not None and encounter.closed_at is not None and elapsed_seconds > 0:
        encounter.created_at = encounter.closed_at - timedelta(seconds=elapsed_seconds)
        session.commit()
    session.refresh(state)
    return review


def test_resolve_range_start_bounds(today=date(2026, 7, 29)):
    # Wednesday 2026-07-29 → Monday is 2026-07-27
    assert resolve_range_start("all", today=today) is None
    assert resolve_range_start("today", today=today) == local_calendar_day_start_as_utc_naive(today)
    assert resolve_range_start("last3days", today=today) == local_calendar_day_start_as_utc_naive(
        today - timedelta(days=2)
    )
    assert resolve_range_start("week", today=today) == local_calendar_day_start_as_utc_naive(
        date(2026, 7, 27)
    )


def test_ladder_progress_tracks_current_stage_and_pass_stats(db_session):
    state = _seed_review_unit(db_session)
    _pass_once(
        db_session,
        state,
        encounter_id="enc-1",
        operation_id="op-1",
        rating=3,
        elapsed_seconds=65,
    )
    # 记得 on first pass lands at the one-day stage.
    assert state.stage_index == 1

    payload = get_palace_ladder_progress(
        db_session,
        state.palace_id,
        unit_id=state.id,
        range_key="all",
    )

    assert payload["ladder"] == [0, 1, 3, 7, 14, 30, 60, 120, 240, 365]
    assert payload["scope"] == "unit"
    assert payload["current"]["unit_id"] == state.id
    assert payload["current"]["stage_index"] == 1
    assert payload["current"]["interval_days"] == 1
    assert payload["palace"]["unit_count"] == 1
    assert payload["palace"]["stage_histogram"][1] == 1
    assert payload["unit_range_stats"]["total_reviews"] == 1
    assert payload["unit_range_stats"]["rating_share"]["remember"] == 1
    assert payload["unit_range_stats"]["per_stage"][0]["pass_count"] == 1
    assert payload["unit_range_stats"]["per_stage"][0]["seconds"] == 65
    assert payload["unit_range_stats"]["per_stage"][1]["pass_count"] == 0
    assert payload["unit_range_stats"]["total_seconds"] == 65
    assert payload["palace_range_stats"]["total_reviews"] == 1


def test_ladder_progress_attributes_easy_jump_to_reviewed_stage(db_session):
    state = _seed_review_unit(db_session, title="跨级归档宫殿")
    _pass_once(
        db_session,
        state,
        encounter_id="enc-easy",
        operation_id="op-easy",
        rating=4,
    )

    payload = get_palace_ladder_progress(
        db_session,
        state.palace_id,
        unit_id=state.id,
        range_key="all",
    )

    assert payload["current"]["stage_index"] == 2
    assert payload["unit_range_stats"]["per_stage"][0]["pass_count"] == 1
    assert payload["unit_range_stats"]["per_stage"][1]["pass_count"] == 0
    assert payload["unit_range_stats"]["per_stage"][2]["pass_count"] == 0


def test_ladder_progress_http_endpoint(session_factory, make_client, db_session):
    from memory_anki.modules.memory.presentation import router as review_router

    state = _seed_review_unit(db_session, title="HTTP 阶梯宫殿")
    _pass_once(db_session, state, encounter_id="enc-http", operation_id="op-http", rating=4)
    # 轻松 on first pass skips to the three-day stage.
    assert state.stage_index == 2
    palace_id = state.palace_id
    unit_id = state.id

    client = make_client(review_router)
    response = client.get(
        f"/api/v1/review/palaces/{palace_id}/ladder-progress",
        params={"range": "all", "unit_id": unit_id},
    )
    assert response.status_code == 200
    item = response.json()["item"]
    assert item["current"]["stage_index"] == 2
    assert item["unit_range_stats"]["rating_share"]["easy"] == 1
    assert item["palace"]["stage_histogram"][2] == 1


def test_ladder_progress_rejects_bad_range(session_factory, make_client, db_session):
    from memory_anki.modules.memory.presentation import router as review_router

    state = _seed_review_unit(db_session, title="坏范围宫殿")
    palace_id = state.palace_id
    client = make_client(review_router)
    response = client.get(
        f"/api/v1/review/palaces/{palace_id}/ladder-progress",
        params={"range": "yesterday"},
    )
    assert response.status_code == 400
