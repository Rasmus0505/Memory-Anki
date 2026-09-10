"""API tests for backend-authoritative freestyle round plans."""

from __future__ import annotations

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.practice.presentation import router as freestyle_router


def _cards(*ids: str) -> list[dict]:
    return [
        {
            "id": card_id,
            "type": "quiz_question" if card_id.startswith("quiz") else "mindmap_branch",
            "label": card_id,
            "palace_id": 1,
            "palace_title": "Palace",
        }
        for card_id in ids
    ]


def _client(make_client):
    freestyle_router.session_dep = session_dep
    return make_client(freestyle_router)


def _create(client, *, operation_id: str, cards: list[dict], round_id: str = "", scope_key: str = "scope-a"):
    response = client.post(
        "/api/v1/freestyle/rounds/active",
        json={
            "operation_id": operation_id,
            "scope_key": scope_key,
            "config": {"queue_length": 20},
            "cards": cards,
            "round_id": round_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_create_and_get_active_round(make_client):
    client = _client(make_client)
    cards = _cards("a", "b", "c")
    created = _create(client, operation_id="op-create", cards=cards, round_id="round-keep")
    assert created["round_id"] == "round-keep"
    assert created["scope_key"] == "scope-a"
    assert created["status"] == "active"
    assert created["version"] == 1
    assert created["plan_version"] == 1
    assert created["conflict"] is False
    assert created["duplicate"] is False
    assert created["current_card_id"] == "a"
    assert created["plan"]["presented_ids"] == ["a", "b", "c"]
    assert created["last_operation_id"] == "op-create"

    again = _create(client, operation_id="op-create-2", cards=cards, round_id="round-other")
    assert again["round_id"] == "round-keep"
    assert again["duplicate"] is False

    fetched = client.get("/api/v1/freestyle/rounds/round-keep")
    assert fetched.status_code == 200, fetched.text
    payload = fetched.json()
    assert payload["round_id"] == "round-keep"
    assert payload["current_card_id"] == "a"
    assert payload["plan"]["current_card_id"] == "a"


def test_version_conflict_returns_latest_and_does_not_overwrite(make_client):
    client = _client(make_client)
    created = _create(client, operation_id="op-create", cards=_cards("a", "b", "c"))
    round_id = created["round_id"]

    moved = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/actions",
        json={
            "operation_id": "op-cursor-b",
            "expected_version": created["version"],
            "action": "set_cursor",
            "card_id": "b",
        },
    )
    assert moved.status_code == 200, moved.text
    latest = moved.json()
    assert latest["current_card_id"] == "b"
    assert latest["version"] == created["version"] + 1
    assert latest["conflict"] is False

    stale = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/actions",
        json={
            "operation_id": "op-cursor-c",
            "expected_version": created["version"],
            "action": "set_cursor",
            "card_id": "c",
        },
    )
    assert stale.status_code == 200, stale.text
    conflicted = stale.json()
    assert conflicted["conflict"] is True
    assert conflicted["duplicate"] is False
    assert conflicted["version"] == latest["version"]
    assert conflicted["current_card_id"] == "b"
    assert conflicted["plan"]["current_card_id"] == "b"

    fetched = client.get(f"/api/v1/freestyle/rounds/{round_id}")
    assert fetched.json()["current_card_id"] == "b"


def test_operation_id_is_idempotent(make_client):
    client = _client(make_client)
    created = _create(client, operation_id="op-create", cards=_cards("a", "b", "c"))
    round_id = created["round_id"]
    body = {
        "operation_id": "op-skip-once",
        "expected_version": created["version"],
        "action": "set_cursor",
        "card_id": "c",
    }
    first = client.post(f"/api/v1/freestyle/rounds/{round_id}/actions", json=body)
    assert first.status_code == 200, first.text
    second = client.post(f"/api/v1/freestyle/rounds/{round_id}/actions", json=body)
    assert second.status_code == 200, second.text
    assert first.json()["version"] == second.json()["version"]
    assert second.json()["duplicate"] is True
    assert second.json()["conflict"] is False
    assert second.json()["current_card_id"] == "c"


def test_start_new_round_completes_previous(make_client):
    client = _client(make_client)
    first = _create(client, operation_id="op-first", cards=_cards("a", "b"), round_id="round-old")
    started = client.post(
        "/api/v1/freestyle/rounds/start",
        json={
            "operation_id": "op-start",
            "scope_key": "scope-a",
            "config": {"queue_length": 10},
            "cards": _cards("x", "y"),
            "round_id": "round-new",
        },
    )
    assert started.status_code == 200, started.text
    payload = started.json()
    assert payload["round_id"] == "round-new"
    assert payload["status"] == "active"
    assert payload["current_card_id"] == "x"
    assert payload["duplicate"] is False

    previous = client.get(f"/api/v1/freestyle/rounds/{first['round_id']}")
    assert previous.status_code == 200, previous.text
    assert previous.json()["status"] == "completed"
    assert previous.json()["round_id"] == "round-old"
    assert payload["round_id"] != first["round_id"]


def test_rating_then_leave_inserts_at_plus_three(make_client):
    client = _client(make_client)
    created = _create(
        client,
        operation_id="op-create",
        cards=_cards("a", "quiz-1", "b", "c", "d"),
        round_id="round-rate",
    )
    round_id = created["round_id"]
    rated = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/ratings",
        json={
            "operation_id": "op-rate-fail",
            "expected_version": created["version"],
            "card_id": "a",
            "occurrence_id": "",
            "encounter_id": "enc-1",
            "rating": 1,
            "study_session_id": "",
            "unit_id": "",
            "unit_revision": 0,
        },
    )
    assert rated.status_code == 200, rated.text
    rated_payload = rated.json()
    assert "round" in rated_payload
    plan = rated_payload["round"]["plan"]
    assert plan["occurrences"]
    assert plan["occurrences"][0]["status"] == "pending"
    assert plan["presented_ids"] == ["a", "quiz-1", "b", "c", "d"]

    left = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/actions",
        json={
            "operation_id": "op-leave-a",
            "expected_version": rated_payload["round"]["version"],
            "action": "leave_card",
            "card_id": "a",
        },
    )
    assert left.status_code == 200, left.text
    after = left.json()
    occ_id = after["plan"]["occurrences"][0]["occurrence_id"]
    assert after["plan"]["occurrences"][0]["status"] == "inserted"
    assert after["plan"]["presented_ids"] == ["a", "quiz-1", "b", "c", occ_id, "d"]
    assert after["plan"]["presented_ids"].index(occ_id) == 4


def test_stale_rating_overwrites_instead_of_conflict(make_client):
    client = _client(make_client)
    created = _create(client, operation_id="op-create", cards=_cards("a", "b", "c"))
    round_id = created["round_id"]
    first = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/ratings",
        json={
            "operation_id": "op-rate-first",
            "expected_version": created["version"],
            "card_id": "a",
            "occurrence_id": "",
            "encounter_id": "enc-1",
            "rating": 1,
            "study_session_id": "",
            "unit_id": "",
            "unit_revision": 0,
        },
    )
    assert first.status_code == 200, first.text
    first_round = first.json()["round"]
    stale = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/ratings",
        json={
            "operation_id": "op-rate-latest",
            "expected_version": created["version"],
            "card_id": "a",
            "occurrence_id": "",
            "encounter_id": "enc-1",
            "rating": 3,
            "study_session_id": "",
            "unit_id": "",
            "unit_revision": 0,
        },
    )
    assert stale.status_code == 200, stale.text
    payload = stale.json()
    assert payload["round"]["conflict"] is False
    assert payload["round"]["version"] > first_round["version"]
    assert payload["round"]["plan"]["encounters"]["a"]["status"] == "passed"


def test_get_restores_same_current_card(make_client):
    client = _client(make_client)
    created = _create(client, operation_id="op-create", cards=_cards("a", "b", "c"))
    round_id = created["round_id"]
    moved = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/actions",
        json={
            "operation_id": "op-cursor-c",
            "expected_version": created["version"],
            "action": "set_cursor",
            "card_id": "c",
        },
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["current_card_id"] == "c"

    fetched = client.get(f"/api/v1/freestyle/rounds/{round_id}")
    assert fetched.status_code == 200, fetched.text
    payload = fetched.json()
    assert payload["current_card_id"] == "c"
    assert payload["plan"]["current_card_id"] == "c"
    assert payload["plan"]["current_index"] == 2
    assert payload["version"] == moved.json()["version"]
