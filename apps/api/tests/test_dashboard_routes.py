"""dashboard aggregate endpoint direct tests."""
from datetime import date, datetime, timedelta

import pytest

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    ReviewLog,
    ReviewSchedule,
)
from memory_anki.modules.dashboard.application.service import build_weekly_report_payload
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.sessions.application.study_session_service import current_week_bounds


@pytest.fixture()
def client(make_client):
    return make_client(dashboard_router)


def test_empty_database_returns_200(client):
    response = client.get("/api/v1/dashboard")

    assert response.status_code == 200
    body = response.json()
    assert body["due_count"] == 0
    assert body["recent_palaces"] == []
    assert body["today_new_palace_count"] == 0


def test_invalid_month_returns_400(client):
    response = client.get(
        "/api/v1/dashboard",
        params={"duration_mode": "month", "month": "not-a-month"},
    )

    assert response.status_code == 400


def test_seeded_palace_and_schedule_show_up(client, session_factory):
    with session_factory() as session:
        now = datetime.now()
        palace = Palace(
            title="P1",
            description="",
            editor_doc="{}",
            created_at=now,
            updated_at=now,
        )
        session.add(palace)
        session.flush()
        session.add(
            ReviewSchedule(
                palace_id=palace.id,
                scheduled_date=date.today() - timedelta(days=1),
                interval_days=1,
                algorithm_used="ebbinghaus",
                completed=False,
                review_number=0,
                review_type="standard",
            )
        )
        palace_id = palace.id
        session.commit()

    body = client.get("/api/v1/dashboard").json()

    assert body["due_count"] == 1
    assert body["reviews"][0]["palace_id"] == palace_id
    assert body["reviews"][0]["overdue_schedule_count"] == 1
    assert body["recent_palaces"][0]["title"] == "P1"
    assert body["today_new_palace_count"] == 1


def test_duration_month_mode_returns_selected_total(client, session_factory):
    now = datetime.now()
    with session_factory() as session:
        session.add(
            StudySession(
                id="session-1",
                status="completed",
                scene="review",
                target_type="palace",
                title="formal review",
                started_at=now,
                ended_at=now + timedelta(minutes=3),
                effective_seconds=180,
            )
        )
        session.commit()

    response = client.get(
        "/api/v1/dashboard",
        params={"duration_mode": "month", "month": now.strftime("%Y-%m")},
    )

    assert response.status_code == 200
    assert response.json()["selected_total_review_duration_seconds"] == 180


def test_duration_range_mode_returns_200(client):
    today = date.today()
    response = client.get(
        "/api/v1/dashboard",
        params={
            "duration_mode": "range",
            "start_date": today.isoformat(),
            "end_date": today.isoformat(),
        },
    )

    assert response.status_code == 200


def test_invalid_range_returns_400(client):
    response = client.get(
        "/api/v1/dashboard",
        params={
            "duration_mode": "range",
            "start_date": "2026-01-02",
            "end_date": "2026-01-01",
        },
    )

    assert response.status_code == 400


def test_heatmap_returns_clamped_contiguous_days(client):
    response = client.get("/api/v1/dashboard/heatmap", params={"days": 3})

    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 7
    assert body["start_date"] == (date.today() - timedelta(days=6)).isoformat()
    assert body["end_date"] == date.today().isoformat()
    assert [item["date"] for item in body["items"]] == [
        (date.today() - timedelta(days=offset)).isoformat()
        for offset in range(6, -1, -1)
    ]


def test_heatmap_aggregates_reviews_sessions_and_streaks(client, session_factory):
    today = date.today()
    yesterday = today - timedelta(days=1)
    two_days_ago = today - timedelta(days=2)
    four_days_ago = today - timedelta(days=4)
    now = datetime.now()
    with session_factory() as session:
        palace = Palace(
            title="Heatmap Palace",
            description="",
            editor_doc="{}",
            created_at=now,
            updated_at=now,
        )
        session.add(palace)
        session.flush()
        session.add_all(
            [
                ReviewLog(
                    palace_id=palace.id,
                    review_date=yesterday,
                    duration_seconds=120,
                ),
                ReviewLog(
                    palace_id=palace.id,
                    review_date=two_days_ago,
                    duration_seconds=60,
                ),
                ReviewLog(
                    palace_id=palace.id,
                    review_date=four_days_ago,
                    duration_seconds=30,
                ),
                StudySession(
                    id="heatmap-session-yesterday",
                    status="completed",
                    scene="review",
                    target_type="palace",
                    title="study",
                    started_at=datetime.combine(yesterday, datetime.min.time()),
                    effective_seconds=300,
                ),
                StudySession(
                    id="heatmap-session-deleted",
                    status="completed",
                    scene="review",
                    target_type="palace",
                    title="deleted",
                    started_at=datetime.combine(today, datetime.min.time()),
                    effective_seconds=300,
                    deleted_at=now,
                ),
            ]
        )
        session.commit()

    response = client.get("/api/v1/dashboard/heatmap", params={"days": 7})

    assert response.status_code == 200
    body = response.json()
    items_by_date = {item["date"]: item for item in body["items"]}
    assert items_by_date[yesterday.isoformat()] == {
        "date": yesterday.isoformat(),
        "review_count": 1,
        "study_seconds": 420,
        "active": True,
    }
    assert items_by_date[today.isoformat()]["active"] is False
    assert body["current_streak"] == 2
    assert body["longest_streak"] == 2
    assert body["active_day_count"] == 3


def test_weekly_report_empty_database_returns_previous_week(client):
    current_week_start, _current_week_end = current_week_bounds()
    week_start = current_week_start - timedelta(days=7)
    week_end = week_start + timedelta(days=6)

    response = client.get("/api/v1/dashboard/weekly-report")

    assert response.status_code == 200
    assert response.json() == {
        "week_start": week_start.date().isoformat(),
        "week_end": week_end.date().isoformat(),
        "study_seconds": 0,
        "review_count": 0,
        "average_score": 0,
        "new_palace_count": 0,
    }


def test_weekly_report_aggregates_requested_week(client, session_factory):
    current_week_start, _current_week_end = current_week_bounds()
    last_week_start = current_week_start - timedelta(days=7)
    last_week_end = current_week_start
    outside_week = last_week_start - timedelta(days=1)
    with session_factory() as session:
        palace = Palace(
            title="Weekly report palace",
            description="",
            editor_doc="{}",
            created_at=last_week_start + timedelta(hours=2),
            updated_at=last_week_start + timedelta(hours=2),
        )
        old_palace = Palace(
            title="Old palace",
            description="",
            editor_doc="{}",
            created_at=outside_week,
            updated_at=outside_week,
        )
        session.add_all([palace, old_palace])
        session.flush()
        session.add_all(
            [
                StudySession(
                    id="weekly-report-session-1",
                    status="completed",
                    scene="review",
                    target_type="palace",
                    palace_id=palace.id,
                    title="review",
                    started_at=last_week_start + timedelta(hours=1),
                    effective_seconds=180,
                ),
                StudySession(
                    id="weekly-report-session-2",
                    status="completed",
                    scene="practice",
                    target_type="palace",
                    palace_id=palace.id,
                    title="practice",
                    started_at=last_week_start + timedelta(days=1),
                    effective_seconds=240,
                ),
                StudySession(
                    id="weekly-report-session-outside",
                    status="completed",
                    scene="review",
                    target_type="palace",
                    palace_id=palace.id,
                    title="outside",
                    started_at=last_week_end,
                    effective_seconds=600,
                ),
                StudySession(
                    id="weekly-report-session-deleted",
                    status="completed",
                    scene="review",
                    target_type="palace",
                    palace_id=palace.id,
                    title="deleted",
                    started_at=last_week_start + timedelta(days=2),
                    effective_seconds=600,
                    deleted_at=datetime.now(),
                ),
                ReviewLog(
                    palace_id=palace.id,
                    review_date=last_week_start.date(),
                    score=4,
                ),
                ReviewLog(
                    palace_id=palace.id,
                    review_date=(last_week_start + timedelta(days=3)).date(),
                    score=5,
                ),
                ReviewLog(
                    palace_id=palace.id,
                    review_date=last_week_end.date(),
                    score=1,
                ),
            ]
        )
        session.commit()

    response = client.get("/api/v1/dashboard/weekly-report", params={"offset_weeks": 1})

    assert response.status_code == 200
    assert response.json() == {
        "week_start": last_week_start.date().isoformat(),
        "week_end": (last_week_end - timedelta(days=1)).date().isoformat(),
        "study_seconds": 420,
        "review_count": 2,
        "average_score": 4.5,
        "new_palace_count": 1,
    }


def test_weekly_report_service_clamps_negative_offset(db_session):
    current_week_start, _current_week_end = current_week_bounds()

    assert build_weekly_report_payload(db_session, offset_weeks=-3)["week_start"] == (
        current_week_start.date().isoformat()
    )
