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


def test_palace_review_workspace_does_not_touch_primary_round(make_client):
    client = _client(make_client)
    primary = _create(
        client,
        operation_id="op-primary",
        cards=_unit_cards(("a", "unit-a"), ("b", "unit-b")),
        round_id="round-primary",
        workspace="primary",
    )
    palace = _create(
        client,
        operation_id="op-palace",
        cards=_unit_cards(("shelf", "unit-shelf")),
        round_id="round-palace-23",
        workspace="p23",
        scope_key="palace-23",
    )
    assert palace["workspace"] == "p23"
    assert palace["round_id"] == "round-palace-23"
    completed = _action(
        client,
        palace["round_id"],
        operation_id="op-palace-complete",
        action="complete",
        version=palace["version"],
        card_id="shelf",
    )
    assert "shelf" in completed["plan"]["completed_ids"]
    untouched = client.get("/api/v1/freestyle/rounds/round-primary").json()
    assert untouched["round_id"] == primary["round_id"]
    assert untouched["status"] == "active"
    assert untouched["current_card_id"] == "a"
    assert "a" not in untouched["plan"]["completed_ids"]
    active = client.get("/api/v1/freestyle/rounds/active", params={"workspace": "p23"})
    assert active.status_code == 200, active.text
    assert active.json()["round_id"] == "round-palace-23"
    primary_active = client.get("/api/v1/freestyle/rounds/active", params={"workspace": "primary"})
    assert primary_active.json()["round_id"] == "round-primary"


def test_secondary_workspace_request_lands_in_the_single_round_slot(make_client):
    """随心2 is merged into 随心: an old client asking for `secondary` gets the one slot."""
    client = _client(make_client)
    created = _create(
        client,
        operation_id="op-merged-slot",
        cards=[{"id": "a", "kind": "mindmap_branch", "unit_id": "unit-a"}],
        workspace="secondary",
    )

    assert created["workspace"] == "primary"
