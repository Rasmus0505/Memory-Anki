"""In-process FastAPI integration against an isolated SQLite database.

Run from the repository root with:
    python -m pytest -q apps/api/tests/test_real_service_replay_integration.py

Mounts production routers with TestClient and a per-test,
file-backed DB. Does not run application startup or use the installed database.
"""
from __future__ import annotations

import json
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine
from sqlalchemy.orm import sessionmaker

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables import _base
from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.content.presentation import router as palace_router
from memory_anki.modules.memory.presentation import router as review_router
from memory_anki.modules.practice.presentation import router as practice_router
from memory_anki.modules.quiz.presentation import router as quiz_router


@pytest.fixture()
def real_client(monkeypatch, tmp_path):
    engine = create_engine(URL.create("sqlite", database=str(tmp_path / "replay.sqlite3")))
    # All production session entry points, including jobs invoked by a route,
    # stay on this test's DB. The shared conftest also isolates runtime paths.
    monkeypatch.setattr(_base, "engine", engine)
    try:
        _base.Base.metadata.create_all(engine)
        app = FastAPI()
        for module in (palace_router, quiz_router, review_router, practice_router):
            app.include_router(module.router, prefix="/api/v1")
        with TestClient(app) as client:
            yield client, sessionmaker(bind=engine)
    finally:
        engine.dispose()


def _editor_doc(*, title="真实 API 隔离验证", node_text="初始节点", node_uid="node-real"):
    return {
        "root": {
            "data": {"uid": "root-real", "text": title, "memoryAnkiRootKind": "palace"},
            "children": [{"data": {"uid": node_uid, "text": node_text}, "children": []}],
        }
    }


def _create_marked_palace(client):
    created = client.post("/api/v1/palaces", json={"title": "真实 API 隔离验证", "description": "", "pegs": []})
    assert created.status_code == 200, created.text
    palace_id = created.json()["id"]
    saved = client.put(
        f"/api/v1/palaces/{palace_id}/editor",
        json={"editor_source": "palace_edit", "editor_doc": _editor_doc()},
    )
    assert saved.status_code == 200, saved.text
    marked = client.post(f"/api/v1/palaces/{palace_id}/mark-root")
    assert marked.status_code == 200, marked.text
    assert marked.json()["review"]["units"], marked.json()
    unit_id = marked.json()["review"]["units"][0]["id"]
    return palace_id, unit_id


def _round_card(unit_id: str, palace_id: int, label: str = "初始节点"):
    return {
        "id": f"review_unit:{unit_id}:r1",
        "type": "mindmap_branch",
        "content_type": "mindmap_branch",
        "kind": "mindmap_branch",
        "label": label,
        "palace_id": palace_id,
        "palace_title": "真实 API 隔离验证",
        "unit_id": unit_id,
        "unit_revision": 1,
        "anchor_uid": "node-real",
        "node_uids": ["node-real"],
    }


def test_real_routes_replay_duplicate_and_late_scores_against_persistent_progress(real_client):
    """Score, replay, then submit a late last-write-wins grade through the routes."""
    client, factory = real_client
    palace_id, unit_id = _create_marked_palace(client)
    build = client.post("/api/v1/freestyle/queue/build", json={
        "operation_id": "build-isolated", "config": {
            "training_mode": "memory_palace",
            "streams": {"memory_palace": {"specific_palace_ids": [palace_id]}},
        },
    })
    assert build.status_code == 200, build.text
    cards = build.json()["cards"]
    assert [card["unit_id"] for card in cards] == [unit_id], build.json()

    created = client.post("/api/v1/freestyle/rounds/active", json={
        "operation_id": "create-isolated-round", "scope_key": "isolated-real-api",
        "config": build.json()["config"], "cards": cards,
        "round_id": "round-isolated-real-api",
    })
    assert created.status_code == 200, created.text
    before = created.json()
    card_id = before["plan"]["original_cards"][0]["card_id"]

    start = client.post(f"/api/v1/review/units/{unit_id}/sessions", json={
        "unit_revision": 1, "encounter_id": "encounter-isolated-first",
        "round_id": before["round_id"], "allow_not_due": True,
        "card_id": card_id, "client_source": "desktop",
    })
    assert start.status_code == 200, start.text
    started = start.json()["item"]
    session_id = started["id"]
    live_unit = next(item for item in started["units"] if item["id"] == unit_id)
    encounter_id = live_unit["encounter"]["id"]
    rating_url = f"/api/v1/freestyle/rounds/{before['round_id']}/ratings"
    grade_body = {
        "operation_id": "grade-isolated-first", "expected_version": before["version"],
        "intent_sequence": 1, "card_id": card_id, "occurrence_id": "",
        "encounter_id": encounter_id, "rating": 3,
        "study_session_id": session_id, "unit_id": unit_id, "unit_revision": 1,
    }
    first = client.post(rating_url, json=grade_body)
    assert first.status_code == 200, first.text
    first_payload = first.json()
    progress = first_payload["round"]["progress"]
    assert progress["items"][0]["own_rating"] == 3
    assert progress["items"][0]["scored"] is True
    assert progress["items"][0]["servable"] is False
    # A passing first encounter owes a short same-day step and cannot settle yet.
    assert progress["fully_handled"] is False
    assert progress["waiting"]["count"] == 1
    assert progress["compressible_ids"] == []
    assert progress["seek_ids"] == progress["retry_seek_ids"] == []
    with factory() as session:
        first_operation = session.get(ReviewUnitRatingOperation, grade_body["operation_id"])
        graded_at = first_operation.created_at
        assert graded_at is not None

    duplicate = client.post(rating_url, json=grade_body)
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["round"]["duplicate"] is True
    assert duplicate.json()["round"]["version"] == first_payload["round"]["version"]
    assert duplicate.json()["round"]["progress"] == progress
    with factory() as session:
        operations = session.query(ReviewUnitRatingOperation).filter_by(unit_id=unit_id).all()
        assert [(row.id, row.created_at) for row in operations] == [(grade_body["operation_id"], graded_at)]
        assert session.get(ReviewUnitState, unit_id).fsrs_last_review is not None

    # A lower intent_sequence arrives late from another client. Persisted contract
    # is last-write-wins for independently identified ratings, even with an old
    # expected round version; duplicate operation ids still replay idempotently.
    late_start = client.post(f"/api/v1/review/units/{unit_id}/sessions", json={
        "unit_revision": 1, "encounter_id": "encounter-isolated-late",
        "round_id": before["round_id"], "allow_not_due": True,
        "card_id": card_id, "client_source": "pwa",
    })
    assert late_start.status_code == 200, late_start.text
    late_session_id = late_start.json()["item"]["id"]
    late_item = next(item for item in late_start.json()["item"]["units"] if item["id"] == unit_id)
    late_body = {
        **grade_body,
        "operation_id": "grade-isolated-late",
        "intent_sequence": 0,
        "encounter_id": late_item["encounter"]["id"],
        "study_session_id": late_session_id,
        "rating": 4,
    }
    late = client.post(rating_url, json=late_body)
    assert late.status_code == 200, late.text
    assert late.json()["round"]["conflict"] is False
    assert late.json()["round"]["progress"]["items"][0]["own_rating"] == 4
    assert client.get(f"/api/v1/freestyle/rounds/{before['round_id']}").json()["progress"]["items"][0]["own_rating"] == 4

    with factory() as session:
        assert session.query(ReviewUnitRatingOperation).filter_by(unit_id=unit_id).count() == 2
        assert session.get(ReviewUnitState, unit_id).fsrs_last_review is not None
        assert session.get(ReviewUnitRatingOperation, grade_body["operation_id"]).created_at == graded_at
        late_operation = session.get(ReviewUnitRatingOperation, late_body["operation_id"])
        assert late_operation.created_at >= graded_at
        assert late_operation.rating == 4

    round_url = f"/api/v1/freestyle/rounds/{before['round_id']}"
    settled_round = late.json()["round"]
    assert settled_round["progress"]["waiting"]["count"] == 0
    assert settled_round["progress"]["fully_handled"] is True
    compressible = settled_round["progress"]["compressible_ids"]
    assert card_id in compressible
    assert not settled_round["progress"]["seek_ids"]
    command = {
        "operation_id": "settle-isolated", "expected_version": settled_round["version"],
        "action": "compress_completed",
        "partial_settlement": {"id": "isolated-settlement", "card_ids": compressible, "card_count": len(compressible), "rated_count": 1},
    }
    settled = client.post(f"{round_url}/actions", json=command)
    assert settled.status_code == 200, settled.text
    assert settled.json()["conflict"] is False
    replay = client.post(f"{round_url}/actions", json=command)
    assert replay.status_code == 200, replay.text
    assert replay.json()["duplicate"] is True
    persisted = client.get(round_url)
    assert persisted.status_code == 200, persisted.text
    assert set(persisted.json()["plan"]["compressed_ids"]) == set(compressible)
    [snapshot] = persisted.json()["plan"]["partial_settlements"]
    assert snapshot["id"] == "isolated-settlement"
    assert snapshot["card_ids"] == compressible


def test_real_round_projection_prioritizes_a_blank_ready_retry_before_its_source(real_client):
    """The mounted route projects a weak retry as a blank selectable task."""
    client, factory = real_client
    palace_id, unit_id = _create_marked_palace(client)
    cards = [
        _round_card(unit_id, palace_id),
        {"id": "neighbor-card", "type": "mindmap_branch", "kind": "mindmap_branch", "label": "相邻卡", "palace_id": palace_id},
        {"id": "last-card", "type": "mindmap_branch", "kind": "mindmap_branch", "label": "末卡", "palace_id": palace_id},
    ]
    created = client.post("/api/v1/freestyle/rounds/active", json={
        "operation_id": "create-retry-projection", "scope_key": "isolated-retry-projection",
        "config": {"queue_length": 20}, "cards": cards,
        "round_id": "round-isolated-retry-projection",
    })
    assert created.status_code == 200, created.text
    card_id = created.json()["plan"]["original_cards"][0]["card_id"]
    retry_id = f"retry:{created.json()['round_id']}:{unit_id}:1"

    with factory() as session:
        row = session.query(FreestyleRoundState).filter_by(round_id=created.json()["round_id"]).one()
        plan = json.loads(row.plan_json)
        plan["occurrences"] = [{
            "occurrence_id": retry_id,
            "source_card_id": card_id,
            "source_unit_id": unit_id,
            "retry_attempt": 1,
            "rating": None,
            "status": "inserted",
            "kind": "retry",
            "encounter_id": "",
            "available_at": None,
        }]
        plan["presented_ids"] = [card_id, "neighbor-card", retry_id, "last-card"]
        plan["current_card_id"] = card_id
        row.plan_json = json.dumps(plan, ensure_ascii=False)
        session.commit()

    fetched = client.get(f"/api/v1/freestyle/rounds/{created.json()['round_id']}")
    assert fetched.status_code == 200, fetched.text
    progress = fetched.json()["progress"]
    assert progress["retry_seek_ids"] == [retry_id]
    assert progress["seek_ids"] == [retry_id, "neighbor-card", "last-card"]
    retry_item = next(item for item in progress["items"] if item["card_id"] == retry_id)
    assert retry_item["scored"] is False
    assert retry_item["servable"] is True
    assert retry_item["occurrence_kind"] == "retry"
    assert progress["fully_handled"] is False
    assert progress["waiting"]["count"] == 0
    assert progress["compressible_ids"] == []

    # Before its spacing elapses, the same occurrence remains owed but cannot
    # be selected; the other blank card is the sole finish target.
    with factory() as session:
        row = session.query(FreestyleRoundState).filter_by(round_id=created.json()["round_id"]).one()
        plan = json.loads(row.plan_json)
        plan["occurrences"][0]["status"] = "pending"
        plan["occurrences"][0]["available_at"] = (utc_now_naive() + timedelta(minutes=10)).isoformat()
        plan["presented_ids"] = [card_id, "neighbor-card", "last-card"]
        row.plan_json = json.dumps(plan, ensure_ascii=False)
        session.commit()
    waiting = client.get(f"/api/v1/freestyle/rounds/{created.json()['round_id']}")
    assert waiting.status_code == 200, waiting.text
    assert waiting.json()["progress"]["retry_seek_ids"] == []
    assert waiting.json()["progress"]["seek_ids"] == ["neighbor-card", "last-card"]
    assert waiting.json()["progress"]["fully_handled"] is False
    assert waiting.json()["progress"]["waiting"]["count"] == 1


def test_real_editor_changes_the_answers_used_for_grading(real_client):
    client, _factory = real_client
    palace_id, _unit_id = _create_marked_palace(client)
    options = [{"id": key, "text": f"选项 {key}"} for key in ("A", "B", "C")]
    created = client.post(f"/api/v1/palaces/{palace_id}/quiz-questions", json={
        "question_type": "multiple_choice", "stem": "初始题干？",
        "options": options, "correct_option_ids": ["A", "B"],
    })
    assert created.status_code == 200, created.text
    question_id = created.json()["item"]["id"]
    url = f"/api/v1/palace-quiz-questions/{question_id}"
    updated = client.put(url, json={
        "stem": "保存后的题干？", "options": options,
        "answer_payload": {"correct_option_ids": ["A", "C"]},
    })
    assert updated.status_code == 200, updated.text
    listed = client.get(f"/api/v1/palaces/{palace_id}/quiz-questions")
    assert listed.status_code == 200, listed.text
    question = next(item for item in listed.json()["items"] if item["id"] == question_id)
    assert question["stem"] == "保存后的题干？"
    assert question["answer_payload"]["correct_option_ids"] == ["A", "C"]
    for selected, expected in ((["A", "B"], False), (["C", "A"], True)):
        response = client.post(f"{url}/choice-attempts", json={"selected_option_ids": selected})
        assert response.status_code == 200, response.text
        assert response.json()["is_correct"] is expected
