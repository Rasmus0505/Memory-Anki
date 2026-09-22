"""API tests for backend-authoritative freestyle round plans."""

from __future__ import annotations

from datetime import date

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
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


def _create(
    client,
    *,
    operation_id: str,
    cards: list[dict],
    round_id: str = "",
    scope_key: str = "scope-a",
    config: dict | None = None,
):
    response = client.post(
        "/api/v1/freestyle/rounds/active",
        json={
            "operation_id": operation_id,
            "scope_key": scope_key,
            "config": config or {"queue_length": 20},
            "cards": cards,
            "round_id": round_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_active_round_reorders_unstarted_when_palace_order_changes(make_client):
    client = _client(make_client)
    sequential = {
        "training_mode": "memory_palace",
        "streams": {
            "memory_palace": {
                "palace_order": "finish_palace_then_next",
                "unit_order": "structured",
                "due_policy": "due_only",
            }
        },
    }
    interleaved = {
        "training_mode": "memory_palace",
        "streams": {
            "memory_palace": {
                "palace_order": "interleave_palaces",
                "unit_order": "random",
                "due_policy": "due_only",
            }
        },
    }
    created = _create(
        client,
        operation_id="op-seq",
        cards=_cards("a1", "a2", "b1", "b2"),
        config=sequential,
    )
    assert created["plan"]["presented_ids"] == ["a1", "a2", "b1", "b2"]

    same_settings = _create(
        client,
        operation_id="op-same",
        cards=_cards("b2", "b1", "a2", "a1"),
        config=sequential,
    )
    assert same_settings["plan"]["presented_ids"] == ["a1", "a2", "b1", "b2"]

    changed = _create(
        client,
        operation_id="op-interleave",
        cards=_cards("a1", "b1", "a2", "b2"),
        config=interleaved,
    )
    assert changed["plan"]["presented_ids"] == ["a1", "b1", "a2", "b2"]


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


def test_active_round_freezes_when_fully_handled_with_leftover_due(make_client):
    """Silent get_or_create must keep settlement; leftover due must not mint/append."""
    client = _client(make_client)
    created = _create(client, operation_id="op-first", cards=_cards("a"), round_id="round-done")
    completed = client.post(
        f"/api/v1/freestyle/rounds/{created['round_id']}/actions",
        json={
            "operation_id": "op-complete-a",
            "expected_version": created["version"],
            "action": "complete",
            "card_id": "a",
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["plan"]["completed_ids"] == ["a"]

    frozen = _create(
        client,
        operation_id="op-leftover-due",
        cards=_cards("a", "b"),
        round_id="round-should-ignore",
    )
    assert frozen["round_id"] == created["round_id"]
    assert frozen["status"] == "active"
    assert frozen["plan"]["completed_ids"] == ["a"]
    assert frozen["plan"]["presented_ids"] == ["a"]
    assert "b" not in frozen["plan"]["presented_ids"]

    started = client.post(
        "/api/v1/freestyle/rounds/start",
        json={
            "operation_id": "op-start-next",
            "scope_key": "scope-a",
            "config": {"queue_length": 20},
            "cards": _cards("b"),
            "round_id": "round-next",
        },
    )
    assert started.status_code == 200, started.text
    payload = started.json()
    assert payload["round_id"] == "round-next"
    assert payload["current_card_id"] == "b"
    previous = client.get(f"/api/v1/freestyle/rounds/{created['round_id']}")
    assert previous.json()["status"] == "completed"


def test_active_round_adopts_workspace_round_across_scope_key(make_client):
    client = _client(make_client)
    created = _create(
        client,
        operation_id="op-create",
        cards=_cards("a", "b", "c"),
        round_id="round-keep",
        scope_key="scope-a",
    )
    round_id = created["round_id"]
    completed = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/actions",
        json={
            "operation_id": "op-complete-a",
            "expected_version": created["version"],
            "action": "complete",
            "card_id": "a",
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["plan"]["completed_ids"] == ["a"]
    assert completed.json()["status"] == "active"

    adopted = _create(
        client,
        operation_id="op-adopt-scope-b",
        cards=_cards("b", "c", "d"),
        scope_key="scope-b",
        round_id="round-other",
    )
    assert adopted["round_id"] == round_id
    assert adopted["scope_key"] == "scope-b"
    assert adopted["status"] == "active"
    assert adopted["plan"]["completed_ids"] == ["a"]
    assert adopted["plan"]["presented_ids"] == ["a", "b", "c", "d"]
    fetched = client.get(f"/api/v1/freestyle/rounds/{round_id}")
    assert fetched.status_code == 200, fetched.text
    payload = fetched.json()
    assert payload["round_id"] == "round-keep"
    assert payload["scope_key"] == "scope-b"
    assert payload["status"] == "active"
    assert payload["plan"]["completed_ids"] == ["a"]


def test_uncomplete_action_clears_completed_ids(make_client):
    client = _client(make_client)
    created = _create(
        client,
        operation_id="op-create-uncomplete",
        cards=_cards("a", "b"),
        round_id="round-uncomplete",
    )
    round_id = created["round_id"]
    completed = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/actions",
        json={
            "operation_id": "op-complete-a",
            "expected_version": created["version"],
            "action": "complete",
            "card_id": "a",
        },
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["plan"]["completed_ids"] == ["a"]

    undone = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/actions",
        json={
            "operation_id": "op-uncomplete-a",
            "expected_version": completed.json()["version"],
            "action": "uncomplete",
            "card_id": "a",
        },
    )
    assert undone.status_code == 200, undone.text
    assert undone.json()["plan"]["completed_ids"] == []


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
    occ_id = plan["occurrences"][0]["occurrence_id"]
    assert plan["occurrences"][0]["status"] == "inserted"
    assert plan["presented_ids"] == ["a", "quiz-1", "b", "c", occ_id, "d"]
    assert plan["presented_ids"].index(occ_id) == 4
    assert plan["current_card_id"] == "a"

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
    assert after["plan"]["occurrences"][0]["occurrence_id"] == occ_id
    assert after["plan"]["occurrences"][0]["status"] == "inserted"
    assert after["plan"]["presented_ids"] == ["a", "quiz-1", "b", "c", occ_id, "d"]
    assert after["plan"]["current_card_id"] == "a"


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


def _review_state(palace_id: int, unit_id: str, *, active: bool = True) -> ReviewUnitState:
    return ReviewUnitState(
        id=unit_id,
        palace_id=palace_id,
        anchor_uid=unit_id,
        unit_kind="mark",
        node_uids_json="[]",
        membership_hash=f"membership-{unit_id}",
        content_hash=f"content-{unit_id}",
        revision=1,
        stage_index=0,
        has_passed=False,
        due_date=date.today(),
        active=active,
    )


def _unit_card(card_id: str, unit_id: str, palace_id: int) -> dict:
    return {
        "id": card_id,
        "type": "mindmap_branch",
        "unit_id": unit_id,
        "unit_revision": 1,
        "palace_id": palace_id,
        "palace_title": "Palace",
        "label": card_id,
    }


def test_get_or_create_drops_vanished_unstarted_and_keeps_live_quiz(
    session_factory, make_client
):
    session = session_factory()
    palace = Palace(title="Live palace", editor_doc="{}", archived=False)
    session.add(palace)
    session.flush()
    session.add(_review_state(palace.id, "live-unit"))
    session.add(_review_state(palace.id, "inactive-unit", active=False))
    session.commit()
    palace_id = palace.id
    session.close()

    client = _client(make_client)
    ghost = _unit_card("review_unit:ghost:r1", "ghost-unit", palace_id)
    inactive = _unit_card("review_unit:inactive:r1", "inactive-unit", palace_id)
    live = _unit_card("review_unit:live-unit:r1", "live-unit", palace_id)
    quiz = {
        "id": "quiz-keep",
        "type": "quiz_question",
        "label": "quiz",
        "palace_id": palace_id,
        "palace_title": "Palace",
    }
    created = _create(
        client,
        operation_id="op-ghost-create",
        cards=[ghost, inactive, live, quiz],
        round_id="round-ghost-drop",
    )
    assert created["current_card_id"] == "review_unit:ghost:r1"

    again = _create(
        client,
        operation_id="op-ghost-drop",
        cards=[live, quiz],
        round_id="round-ignored",
    )
    assert again["round_id"] == "round-ghost-drop"
    original_ids = [item["card_id"] for item in again["plan"]["original_cards"]]
    assert original_ids == ["review_unit:live-unit:r1", "quiz-keep"]
    assert again["current_card_id"] == "review_unit:live-unit:r1"
    assert "review_unit:ghost:r1" not in again["plan"]["presented_ids"]
    assert "review_unit:inactive:r1" not in again["plan"]["presented_ids"]


def test_vanished_drop_that_finishes_the_round_does_not_append(session_factory, make_client):
    session = session_factory()
    palace = Palace(title="Empty after drop", editor_doc="{}", archived=False)
    session.add(palace)
    session.commit()
    palace_id = palace.id
    session.close()

    client = _client(make_client)
    ghost = _unit_card("review_unit:only-ghost:r1", "missing-unit", palace_id)
    created = _create(
        client,
        operation_id="op-only-ghost",
        cards=[ghost],
        round_id="round-freeze-drop",
    )
    assert created["current_card_id"] == "review_unit:only-ghost:r1"

    live = _unit_card("review_unit:new-due:r1", "new-due", palace_id)
    frozen = _create(
        client,
        operation_id="op-should-not-append",
        cards=[live],
        round_id="round-should-not-append",
    )
    assert frozen["round_id"] == "round-freeze-drop"
    assert frozen["plan"]["original_cards"] == []
    assert frozen["plan"]["presented_ids"] == []
    assert frozen["current_card_id"] in {None, ""}
    fetched = client.get("/api/v1/freestyle/rounds/round-freeze-drop")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["plan"]["original_cards"] == []
