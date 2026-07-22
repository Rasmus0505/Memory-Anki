"""API tests for freestyle immersive queue build."""

from __future__ import annotations

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.practice.presentation import router as freestyle_router


def test_queue_build_requires_operation_id(make_client):
    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post("/api/v1/freestyle/queue/build", json={"config": {}})
    assert response.status_code == 422


def test_queue_build_echoes_operation_and_sanitized_config(make_client):
    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-test-1",
            "config": {
                "node_limit": 12,
                "queue_length": 20,
                "seed": 7,
                "content": {"mindmap_branch": True, "quiz_question": True},
            },
            "completed_ids": [],
            "hidden_ids": [],
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["operation_id"] == "op-test-1"
    assert payload["config"]["node_limit"] == 12
    assert payload["config"]["queue_length"] == 20
    assert "cards" in payload
    assert "phase_stats" in payload
    assert payload["counts"]["total"] == len(payload["cards"])


def test_queue_build_accepts_empty_palace_filter(make_client):
    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-empty",
            "config": {
                "specific_palace_ids": [999999],
                "content": {"mindmap_branch": True, "quiz_question": True},
            },
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["cards"] == []
    assert payload["counts"]["total"] == 0
