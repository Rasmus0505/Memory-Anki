"""Two freestyle workspaces keep independent rounds and inherit overlapping progress."""

from __future__ import annotations

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.practice.presentation import router as freestyle_router


def _unit_cards(*pairs: tuple[str, str]) -> list[dict]:
    return [
        {
            "id": card_id,
            "type": "mindmap_branch",
            "kind": "mindmap_branch",
            "unit_id": unit_id,
            "unit_revision": 1,
            "palace_id": 1,
            "palace_title": "Palace",
            "label": card_id,
        }
        for card_id, unit_id in pairs
    ]


def _client(make_client):
    freestyle_router.session_dep = session_dep
    return make_client(freestyle_router)


def _create(client, *, operation_id: str, cards: list[dict], workspace: str = "primary", **fields):
    payload = {
        "operation_id": operation_id,
        "scope_key": fields.pop("scope_key", "scope-a"),
        "config": fields.pop("config", {"queue_length": 20}),
        "cards": cards,
        "workspace": workspace,
        **fields,
    }
    response = client.post("/api/v1/freestyle/rounds/active", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def _action(client, round_id: str, *, operation_id: str, action: str, version: int, card_id: str):
    response = client.post(
        f"/api/v1/freestyle/rounds/{round_id}/actions",
        json={
            "operation_id": operation_id,
            "expected_version": version,
            "action": action,
            "card_id": card_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_missing_workspace_defaults_to_primary(make_client):
    client = _client(make_client)
    created = _create(
        client,
        operation_id="op-default",
        cards=_unit_cards(("a", "unit-a")),
        round_id="round-default",
        workspace="primary",
    )
    assert created["workspace"] == "primary"


def test_two_workspaces_keep_independent_cursors(make_client):
    client = _client(make_client)
    cards = _unit_cards(("a", "unit-a"), ("b", "unit-b"))
    primary = _create(client, operation_id="op-a", cards=cards, round_id="round-a", workspace="primary")
    secondary = _create(
        client,
        operation_id="op-b",
        cards=cards,
        round_id="round-b",
        workspace="secondary",
    )
    assert primary["round_id"] == "round-a"
    assert secondary["round_id"] == "round-b"
    assert primary["workspace"] == "primary"
    assert secondary["workspace"] == "secondary"
    assert primary["current_card_id"] == "a"
    assert secondary["current_card_id"] == "a"

    moved = _action(
        client,
        secondary["round_id"],
        operation_id="op-cursor",
        action="set_cursor",
        version=secondary["version"],
        card_id="b",
    )
    assert moved["current_card_id"] == "b"
    fetched = client.get("/api/v1/freestyle/rounds/round-a")
    assert fetched.status_code == 200
    assert fetched.json()["current_card_id"] == "a"


def test_complete_on_primary_marks_overlapping_secondary_card(make_client):
    client = _client(make_client)
    primary = _create(
        client,
        operation_id="op-a",
        cards=_unit_cards(("a", "unit-a"), ("b", "unit-b")),
        round_id="round-a",
        workspace="primary",
    )
    secondary = _create(
        client,
        operation_id="op-b",
        cards=_unit_cards(("x", "unit-a"), ("y", "unit-c")),
        round_id="round-b",
        workspace="secondary",
    )
    completed = _action(
        client,
        primary["round_id"],
        operation_id="op-complete",
        action="complete",
        version=primary["version"],
        card_id="a",
    )
    assert "a" in completed["plan"]["completed_ids"]
    peer = client.get("/api/v1/freestyle/rounds/round-b").json()
    assert "x" in peer["plan"]["completed_ids"]
    assert "y" not in peer["plan"]["completed_ids"]
    assert peer["current_card_id"] == secondary["current_card_id"]


def test_start_new_round_only_resets_current_workspace_and_seeds_overlap(make_client):
    client = _client(make_client)
    primary = _create(
        client,
        operation_id="op-a",
        cards=_unit_cards(("a", "unit-a"), ("b", "unit-b")),
        round_id="round-a",
        workspace="primary",
    )
    _create(
        client,
        operation_id="op-b",
        cards=_unit_cards(("x", "unit-a"), ("y", "unit-c")),
        round_id="round-b",
        workspace="secondary",
    )
    _action(
        client,
        primary["round_id"],
        operation_id="op-complete",
        action="complete",
        version=primary["version"],
        card_id="a",
    )
    restarted = client.post(
        "/api/v1/freestyle/rounds/start",
        json={
            "operation_id": "op-restart-b",
            "scope_key": "scope-a",
            "workspace": "secondary",
            "config": {"queue_length": 20},
            "cards": _unit_cards(("x", "unit-a"), ("y", "unit-c")),
            "round_id": "round-b-2",
        },
    )
    assert restarted.status_code == 200, restarted.text
    body = restarted.json()
    assert body["round_id"] == "round-b-2"
    assert "x" in body["plan"]["completed_ids"]
    assert body["current_card_id"] == "y"
    leftover = client.get("/api/v1/freestyle/rounds/round-a").json()
    assert leftover["status"] == "active"
    assert leftover["round_id"] == "round-a"
    assert leftover["current_card_id"] == "b"
