from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from memory_anki.core.time import local_calendar_day_start_as_utc_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.modules.session.application.time_bounds import today_bounds
from memory_anki.modules.session.application.time_record_read_model import (
    build_time_record_read_model,
)
from memory_anki.modules.session.presentation import router as sessions_router


def _local_time(day: date, hour: int = 12) -> datetime:
    return local_calendar_day_start_as_utc_naive(day) + timedelta(hours=hour)


def _record(
    record_id: str,
    *,
    scene: str,
    seconds: int,
    ended_day: date,
    source: str | None = None,
    status: str = "completed",
    deleted: bool = False,
    started_day: date | None = None,
    activity_tag: str | None = None,
) -> StudySession:
    summary: dict[str, str] = {}
    if source:
        summary["client_source"] = source
    if activity_tag:
        summary["activity_tag"] = activity_tag
        summary["activity_tag_label"] = f"标签-{activity_tag}"
    return StudySession(
        id=record_id,
        status=status,
        scene=scene,
        target_type="none",
        title=record_id,
        started_at=_local_time(started_day or ended_day, 8),
        ended_at=_local_time(ended_day, 12),
        effective_seconds=seconds,
        progress_json="{}",
        events_json="[]",
        summary_json=json.dumps(summary, ensure_ascii=False),
        deleted_at=_local_time(ended_day, 13) if deleted else None,
    )


def _seed_reconciliation_records(session) -> None:
    july_2 = date(2026, 7, 2)
    july_3 = date(2026, 7, 3)
    session.add_all(
        [
            _record("review-old", scene="review", seconds=100, ended_day=july_2, source="desktop"),
            _record("review-formal", scene="formal_unit_review", seconds=200, ended_day=july_2, source="pwa"),
            _record("review-freestyle", scene="freestyle_unit_review", seconds=300, ended_day=july_2),
            _record("review-segment", scene="segment_review", seconds=400, ended_day=july_2, source="desktop"),
            _record("review-mini", scene="mini_review", seconds=500, ended_day=july_2, source="pwa"),
            _record("english", scene="english", seconds=600, ended_day=july_3, source="desktop"),
            _record("english-reading", scene="english_reading", seconds=700, ended_day=july_3, source="pwa"),
            _record("quiz", scene="quiz", seconds=800, ended_day=july_3),
            _record("palace-edit", scene="palace_edit", seconds=900, ended_day=july_3, source="desktop"),
            _record("custom", scene="custom", seconds=1_000, ended_day=july_3, source="pwa", activity_tag="focus"),
            _record("practice", scene="freestyle", seconds=1_100, ended_day=july_3, source="desktop"),
            _record("manual", scene="custom", seconds=1_200, ended_day=july_3),
            # A custom tag owns the classification even when the legacy scene says review.
            _record("custom-over-review", scene="review", seconds=1_300, ended_day=july_3, source="desktop", activity_tag="research"),
            _record("active", scene="practice", seconds=5_000, ended_day=july_3, status="active"),
            _record("abandoned", scene="practice", seconds=5_000, ended_day=july_3, status="abandoned"),
            _record("deleted", scene="practice", seconds=5_000, ended_day=july_3, deleted=True),
            _record("zero", scene="practice", seconds=0, ended_day=july_3),
            _record("negative", scene="practice", seconds=-10, ended_day=july_3),
        ]
    )
    session.commit()


def test_unified_read_model_reconciles_items_devices_kinds_and_trend(db_session):
    _seed_reconciliation_records(db_session)

    payload = build_time_record_read_model(
        db_session,
        range_mode="custom",
        start_date="2026-07-01",
        end_date="2026-07-31",
        limit=5,
        offset=0,
        reference_date=date(2026, 7, 30),
    )

    summary = payload["summary"]
    assert payload["total"] == summary["record_count"] == 13
    assert len(payload["items"]) == 5
    assert summary["total_effective_seconds"] == 9_100
    assert summary["desktop_effective_seconds"] == 4_400
    assert summary["pwa_effective_seconds"] == 2_400
    assert summary["unknown_effective_seconds"] == 2_300
    assert (
        summary["desktop_effective_seconds"]
        + summary["pwa_effective_seconds"]
        + summary["unknown_effective_seconds"]
        == summary["total_effective_seconds"]
    )
    assert sum(item["seconds"] for item in payload["kind_breakdown"]) == 9_100
    assert sum(item["seconds"] for item in payload["trend"]) == 9_100

    breakdown = {item["kind"]: item["seconds"] for item in payload["kind_breakdown"]}
    assert breakdown["review"] == 1_500
    assert breakdown["practice"] == 1_100
    assert breakdown["english"] == 600
    assert breakdown["english_reading"] == 700
    assert breakdown["quiz"] == 800
    assert breakdown["palace_edit"] == 900
    assert breakdown["focus"] == 1_000
    assert breakdown["custom"] == 1_200
    assert breakdown["research"] == 1_300


def test_kind_filter_uses_the_same_classification_as_breakdown(db_session):
    _seed_reconciliation_records(db_session)

    review = build_time_record_read_model(
        db_session,
        range_mode="all",
        kind="review",
        reference_date=date(2026, 7, 30),
    )
    custom = build_time_record_read_model(
        db_session,
        range_mode="all",
        kind="custom",
        reference_date=date(2026, 7, 30),
    )

    assert review["summary"]["total_effective_seconds"] == 1_500
    assert sum(item["seconds"] for item in review["kind_breakdown"]) == 1_500
    assert custom["summary"]["total_effective_seconds"] == 3_500
    assert sum(item["seconds"] for item in custom["kind_breakdown"]) == 3_500
    assert {item["id"] for item in custom["items"]} == {
        "custom",
        "manual",
        "custom-over-review",
    }


def test_ranges_attribute_records_by_completion_time(db_session):
    db_session.add_all(
        [
            _record(
                "completed-july",
                scene="practice",
                seconds=100,
                started_day=date(2026, 6, 1),
                ended_day=date(2026, 7, 2),
            ),
            _record("completed-june", scene="practice", seconds=200, ended_day=date(2026, 6, 15)),
            _record("rolling-seven", scene="practice", seconds=300, ended_day=date(2026, 7, 25)),
            _record("outside-seven", scene="practice", seconds=400, ended_day=date(2026, 7, 20)),
            _record("older", scene="practice", seconds=500, ended_day=date(2026, 4, 1)),
        ]
    )
    db_session.commit()

    month = build_time_record_read_model(
        db_session,
        range_mode="month",
        month="2026-07",
        reference_date=date(2026, 7, 30),
    )
    rolling = build_time_record_read_model(
        db_session,
        range_mode="rolling",
        rolling_days=7,
        reference_date=date(2026, 7, 30),
    )
    custom = build_time_record_read_model(
        db_session,
        range_mode="custom",
        start_date="2026-06-01",
        end_date="2026-06-30",
        reference_date=date(2026, 7, 30),
    )
    all_history = build_time_record_read_model(
        db_session,
        range_mode="all",
        reference_date=date(2026, 7, 30),
    )

    assert month["summary"]["total_effective_seconds"] == 800
    assert rolling["summary"]["total_effective_seconds"] == 300
    assert custom["summary"]["total_effective_seconds"] == 200
    assert all_history["summary"]["total_effective_seconds"] == 1_500


def test_today_range_uses_local_calendar_day_and_shared_summary(db_session):
    today = date(2026, 7, 30)
    db_session.add_all(
        [
            _record("today-one", scene="practice", seconds=100, ended_day=today),
            _record("today-two", scene="quiz", seconds=200, ended_day=today),
            _record("yesterday", scene="practice", seconds=400, ended_day=today - timedelta(days=1)),
            _record("tomorrow", scene="practice", seconds=800, ended_day=today + timedelta(days=1)),
        ]
    )
    db_session.commit()

    payload = build_time_record_read_model(
        db_session,
        range_mode="today",
        reference_date=today,
    )

    assert payload["range"] == {
        "mode": "today",
        "month": None,
        "rolling_days": None,
        "start_date": "2026-07-30",
        "end_date": "2026-07-30",
    }
    assert payload["summary"]["total_effective_seconds"] == 300
    assert {item["id"] for item in payload["items"]} == {"today-one", "today-two"}


def test_time_records_endpoint_returns_paginated_items_and_unpaged_reconciliation(
    session_factory,
    make_client,
):
    with session_factory() as session:
        _seed_reconciliation_records(session)
    client = make_client(sessions_router)

    response = client.get(
        "/api/v1/study-sessions/time-records",
        params={
            "range_mode": "custom",
            "start_date": "2026-07-01",
            "end_date": "2026-07-31",
            "limit": 2,
            "offset": 2,
            "sort_by": "effective_seconds",
            "sort_order": "desc",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 2
    assert payload["total"] == payload["summary"]["record_count"] == 13
    assert payload["summary"]["total_effective_seconds"] == 9_100
    assert sum(item["seconds"] for item in payload["kind_breakdown"]) == 9_100
    assert sum(item["seconds"] for item in payload["trend"]) == 9_100


def test_time_records_endpoint_accepts_today_range(session_factory, make_client):
    today_start, _ = today_bounds()
    with session_factory() as session:
        session.add(
            StudySession(
                id="today-endpoint-record",
                status="completed",
                scene="practice",
                target_type="none",
                title="today endpoint record",
                started_at=today_start + timedelta(hours=8),
                ended_at=today_start + timedelta(hours=9),
                effective_seconds=3_600,
            )
        )
        session.commit()

    client = make_client(sessions_router)
    response = client.get(
        "/api/v1/study-sessions/time-records",
        params={"range_mode": "today"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["range"]["mode"] == "today"
    assert payload["summary"]["total_effective_seconds"] == 3_600
