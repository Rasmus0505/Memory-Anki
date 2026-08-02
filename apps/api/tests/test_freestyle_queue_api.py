"""API tests for freestyle immersive queue build."""

from __future__ import annotations

import json

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.memory.application.unit_review_projection import reconcile_palace_units
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
                "progress_scopes": ["reinforcement"],
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
    assert "node_limit" not in payload["config"]
    assert "progress_scopes" not in payload["config"]
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


def test_queue_build_returns_due_units_for_selected_palace(session_factory, make_client):
    session = session_factory()
    palace = Palace(
        title="Selected palace",
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "Selected palace", "permanentSplitMark": True},
                    "children": [
                        {"data": {"uid": "branch", "text": "Due branch"}, "children": []},
                    ],
                }
            }
        ),
    )
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    palace_id = palace.id
    session.close()
    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-selected-palace",
            "config": {
                "specific_palace_ids": [palace_id],
                "content": {
                    "mindmap_branch": True,
                    "anki_card": False,
                    "quiz_question": False,
                },
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            },
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["phase_stats"]["due_unit_count"] == 1
    assert payload["counts"]["mindmap_branch"] == 1
    assert {card["palace_id"] for card in payload["cards"]} == {palace_id}
