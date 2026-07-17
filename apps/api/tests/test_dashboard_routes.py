"""dashboard aggregate endpoint direct tests."""
import json
from datetime import datetime, timedelta

import pytest

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewLog
from memory_anki.modules.dashboard.application.service import build_weekly_report_payload
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.sessions.application.study_session_service import current_week_bounds

EDITOR_DOC = json.dumps(
    {
        "root": {
            "data": {"text": "P1", "uid": "root"},
            "children": [
                {"data": {"text": "A", "uid": "a"}, "children": []},
                {"data": {"text": "B", "uid": "b"}, "children": []},
            ],
        }
    }
)


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


def test_seeded_palace_with_fsrs_nodes_shows_up(client, session_factory):
    with session_factory() as session:
        now = datetime.now()
        palace = Palace(
            title="P1",
            description="",
            editor_doc=EDITOR_DOC,
            created_at=now,
            updated_at=now,
        )
        session.add(palace)
        session.flush()
        palace_id = palace.id
        session.commit()

    body = client.get("/api/v1/dashboard").json()

    assert body["due_count"] == 2
    assert body["reviews"][0]["palace_id"] == palace_id
    assert body["reviews"][0]["due_node_count"] == 2
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

    response = client.get("/api/v1/dashboard", params={"duration_mode": "month"})
    assert response.status_code == 200
    assert response.json()["selected_total_review_duration_seconds"] >= 0


def test_weekly_report_payload(session_factory):
    with session_factory() as session:
        week_start, _ = current_week_bounds()
        palace = Palace(title="Weekly", editor_doc=EDITOR_DOC)
        session.add(palace)
        session.flush()
        session.add(
            ReviewLog(
                palace_id=palace.id,
                review_date=(week_start - timedelta(days=1)).date(),
                score=4,
                review_mode="fsrs",
                duration_seconds=60,
                note="ok",
            )
        )
        session.commit()
        payload = build_weekly_report_payload(session, offset_weeks=1)

    assert "week_start" in payload
    assert "review_count" in payload
    assert "study_seconds" in payload
