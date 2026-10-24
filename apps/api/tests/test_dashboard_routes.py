"""dashboard aggregate endpoint direct tests."""
import json

import pytest

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.dashboard.application.service import build_weekly_report_payload
from memory_anki.modules.dashboard.presentation import router as dashboard_router
from memory_anki.modules.memory.api import reconcile_palace_units

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


def test_seeded_palace_with_permanent_mark_unit_shows_up(client, session_factory):
    with session_factory() as session:
        now = utc_now_naive()
        palace = Palace(
            title="P1",
            description="",
            editor_doc=EDITOR_DOC.replace('"uid": "root"', '"uid": "root", "permanentSplitMark": true'),
            created_at=now,
            updated_at=now,
        )
        session.add(palace)
        session.flush()
        palace_id = palace.id
        session.commit()
        reconcile_palace_units(session, palace_id)
        session.commit()

    body = client.get("/api/v1/dashboard").json()

    assert body["due_count"] == 1
    assert body["reviews"][0]["palace_id"] == palace_id
    assert body["reviews"][0]["node_count"] >= 1
    assert body["recent_palaces"][0]["title"] == "P1"
    assert body["today_new_palace_count"] == 1


def test_dashboard_cache_is_invalidated_after_a_write(client, session_factory, monkeypatch):
    monkeypatch.setattr(dashboard_router, "_DASHBOARD_SNAPSHOT_TTL_SECONDS", 3600.0)
    assert client.get("/api/v1/dashboard").json()["today_new_palace_count"] == 0

    with session_factory() as session:
        now = utc_now_naive()
        session.add(Palace(title="Fresh", editor_doc=EDITOR_DOC, created_at=now, updated_at=now))
        session.commit()

    # 同一个五秒窗口内，普通读取仍复用快照；只有写请求的失效信号能让它重建。
    assert client.get("/api/v1/dashboard").json()["today_new_palace_count"] == 0

    dashboard_router.request_dashboard_refresh()

    assert client.get("/api/v1/dashboard").json()["today_new_palace_count"] == 1


def test_dashboard_payload_has_no_duration_fields(session_factory):
    from memory_anki.modules.dashboard.application.service import build_dashboard_payload

    with session_factory() as session:
        body = build_dashboard_payload(session)

    assert not [key for key in body if "duration" in key]
    assert "today_learning_palaces" not in body
    assert body["english_stats"] == {
        "total_courses": 0,
        "unfinished_courses": 0,
        "completed_courses": 0,
    }
    assert "review_duration_seconds" not in body["stats"]


def test_weekly_report_payload(session_factory):
    with session_factory() as session:
        palace = Palace(title="Weekly", editor_doc=EDITOR_DOC)
        session.add(palace)
        session.flush()
        session.commit()
        payload = build_weekly_report_payload(session, offset_weeks=1)

    assert "week_start" in payload
    assert "review_count" in payload
    assert "study_seconds" not in payload


def test_heatmap_items_have_no_study_seconds(session_factory):
    from memory_anki.modules.dashboard.application.heatmap_service import build_heatmap_payload

    with session_factory() as session:
        payload = build_heatmap_payload(session, days=7)

    assert len(payload["items"]) == 7
    assert all("study_seconds" not in item for item in payload["items"])
    assert all(item["review_count"] == 0 and item["active"] is False for item in payload["items"])
