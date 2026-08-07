"""API tests for freestyle immersive queue build."""

from __future__ import annotations

import json

from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.memory.application.unit_review_projection import reconcile_palace_units
from memory_anki.modules.memory.presentation import router as review_router
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


def test_queue_build_unions_subject_scope_with_explicit_palace(session_factory, make_client):
    session = session_factory()
    english = Subject(name="英语")
    education = Subject(name="教育学")
    session.add_all([english, education])
    session.flush()

    def add_palace(title: str, subject: Subject, uid: str):
        palace = Palace(
            title=title,
            subjects=[subject],
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"uid": f"{uid}-root", "text": title, "permanentSplitMark": True},
                        "children": [{"data": {"uid": uid, "text": "Due branch"}, "children": []}],
                    }
                }
            ),
        )
        session.add(palace)
        session.flush()
        reconcile_palace_units(session, palace.id)
        return palace

    english_palace = add_palace("English palace", english, "english-branch")
    education_palace = add_palace("卢梭的教育思想", education, "rousseau-branch")
    session.commit()
    english_id = english_palace.id
    education_id = education_palace.id
    session.close()

    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-subject-plus-explicit",
            "config": {
                "specific_palace_ids": [education_id],
                "subject_scope": "english",
                "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert {card["palace_id"] for card in payload["cards"]} == {english_id, education_id}


def test_queue_revision_can_start_review_after_projection_reconciliation(
    session_factory,
    make_client,
):
    session = session_factory()
    palace = Palace(
        title="卢梭的教育思想",
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "卢梭的教育思想", "permanentSplitMark": True},
                    "children": [{"data": {"uid": "branch", "text": "旧内容"}, "children": []}],
                }
            },
            ensure_ascii=False,
        ),
    )
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()

    palace.editor_doc = json.dumps(
        {
            "root": {
                "data": {"uid": "root", "text": "卢梭的教育思想", "permanentSplitMark": True},
                "children": [{"data": {"uid": "branch", "text": "新内容"}, "children": []}],
            }
        },
        ensure_ascii=False,
    )
    session.commit()
    palace_id = palace.id
    session.close()

    freestyle_router.session_dep = session_dep
    queue_client = make_client(freestyle_router)
    queued = queue_client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-rousseau-reconciled",
            "config": {
                "specific_palace_ids": [palace_id],
                "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            },
        },
    )

    assert queued.status_code == 200, queued.text
    card = queued.json()["cards"][0]
    assert card["palace_id"] == palace_id

    review_router.session_dep = session_dep
    review_client = make_client(review_router)
    started = review_client.post(
        f"/api/v1/review/units/{card['unit_id']}/sessions",
        json={
            "unit_revision": card["unit_revision"],
            "round_id": "round-rousseau-reconciled",
            "encounter_id": "encounter-rousseau-reconciled",
        },
    )

    assert started.status_code == 200, started.text
    assert started.json()["item"]["units"][0]["revision"] == card["unit_revision"]
    with session_factory() as check:
        state = check.get(ReviewUnitState, card["unit_id"])
        assert state is not None
        assert state.revision == card["unit_revision"]
