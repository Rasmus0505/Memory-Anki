"""调度透明层路由：今日任务/间隔预览/卡片详情/负载模拟/宫殿设置/聚合。"""

from __future__ import annotations

import json

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.memory.presentation import router as memory_router


@pytest.fixture()
def client(make_client):
    return make_client(memory_router)


def _seed_palace(session_factory):
    document = {
        "root": {
            "data": {"uid": "root", "text": "root"},
            "children": [
                {"data": {"uid": "a", "text": "A"}, "children": []},
                {"data": {"uid": "b", "text": "B"}, "children": []},
            ],
        }
    }
    with session_factory() as session:
        palace = Palace(
            title="Routes", description="", difficulty=0, review_mode="review",
            editor_doc=json.dumps(document),
        )
        session.add(palace)
        session.commit()
        return int(palace.id)


def test_today_plan_and_preview_and_detail(client, session_factory):
    palace_id = _seed_palace(session_factory)

    plan = client.get("/api/v1/review/today-plan")
    assert plan.status_code == 200
    item = plan.json()["item"]
    assert item["new_pending"] == 2
    assert item["review_quota"] > 0
    assert isinstance(item["palaces"], list)

    preview = client.post(
        "/api/v1/review/preview-intervals",
        json={"items": [{"palace_id": palace_id, "node_uid": "a"}]},
    )
    assert preview.status_code == 200
    previews = preview.json()["items"][0]["previews"]
    assert {p["rating"] for p in previews} == {1, 2, 3, 4}
    assert all(p["display"] for p in previews)

    detail = client.get(
        f"/api/v1/review/palaces/{palace_id}/nodes/a/schedule-detail"
    )
    assert detail.status_code == 200
    body = detail.json()["item"]
    assert body["exists"] is True  # today-plan 已放出该新卡
    assert len(body["previews"]) == 4


def test_simulate_load_and_palace_settings(client, session_factory):
    palace_id = _seed_palace(session_factory)

    sim = client.post(
        "/api/v1/review/simulate-load", json={"desired_retention": 0.85, "days": 14}
    )
    assert sim.status_code == 200
    body = sim.json()["item"]
    assert body["desired_retention"] == 0.85
    assert len(body["items"]) == 14

    put = client.put(
        f"/api/v1/review/palaces/{palace_id}/settings",
        json={"aggregation_enabled": True, "daily_new_limit_override": 5},
    )
    assert put.status_code == 200
    assert put.json()["item"]["aggregation_enabled"] is True

    got = client.get(f"/api/v1/review/palaces/{palace_id}/settings")
    assert got.json()["item"]["daily_new_limit_override"] == 5

    preview = client.post(
        f"/api/v1/review/palaces/{palace_id}/aggregation/preview", json={}
    )
    assert preview.status_code == 200
    assert "moves" in preview.json()["item"]

    off = client.put(
        f"/api/v1/review/palaces/{palace_id}/settings",
        json={"aggregation_enabled": False},
    )
    assert off.status_code == 200
    assert off.json()["item"]["aggregation_enabled"] is False
