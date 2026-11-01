"""Palace favorites: toggle, list, and serialization."""

from __future__ import annotations

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.content.presentation import router as palace_router


@pytest.fixture()
def client(make_client):
    return make_client(palace_router)


def _create_palace(client, title: str = "收藏测试宫殿") -> int:
    response = client.post("/api/v1/palaces", json={"title": title, "description": "", "pegs": []})
    assert response.status_code == 200
    return int(response.json()["id"])


def test_favorite_toggle_lists_and_serializes(client):
    palace_id = _create_palace(client)

    assert client.get(f"/api/v1/palaces/{palace_id}").json()["is_favorite"] is False
    assert palace_id not in client.get("/api/v1/palaces/favorites").json()["ids"]

    response = client.put(f"/api/v1/palaces/{palace_id}/favorite", json={"is_favorite": True})
    assert response.status_code == 200
    assert response.json() == {"ok": True, "is_favorite": True}
    assert client.get(f"/api/v1/palaces/{palace_id}").json()["is_favorite"] is True
    assert client.get("/api/v1/palaces/favorites").json()["ids"] == [palace_id]

    response = client.put(f"/api/v1/palaces/{palace_id}/favorite", json={"is_favorite": False})
    assert response.status_code == 200
    assert response.json() == {"ok": True, "is_favorite": False}
    assert client.get("/api/v1/palaces/favorites").json()["ids"] == []


def test_favorite_does_not_reorder_the_catalog(client, session_factory):
    palace_id = _create_palace(client, "收藏不改变目录顺序")
    with session_factory() as session:
        before = session.get(Palace, palace_id).updated_at

    assert client.put(f"/api/v1/palaces/{palace_id}/favorite", json={"is_favorite": True}).status_code == 200

    with session_factory() as session:
        palace = session.get(Palace, palace_id)
        assert palace.is_favorite is True
        # The catalog orders by updated_at; starring must not bump it.
        assert palace.updated_at == before


def test_favorite_missing_palace_is_not_found(client):
    response = client.put("/api/v1/palaces/999999/favorite", json={"is_favorite": True})
    assert response.status_code == 404
    assert response.json()["detail"] == "not found"


def test_favorite_ids_skip_deleted_and_archived(client):
    deleted = _create_palace(client, "删除的")
    archived = _create_palace(client, "归档的")
    kept = _create_palace(client, "保留的")
    for palace_id in (deleted, archived, kept):
        assert client.put(
            f"/api/v1/palaces/{palace_id}/favorite", json={"is_favorite": True}
        ).status_code == 200

    assert client.delete(f"/api/v1/palaces/{deleted}").status_code == 200
    assert client.put(f"/api/v1/palaces/{archived}/archive", json={"archived": True}).status_code == 200

    assert client.get("/api/v1/palaces/favorites").json()["ids"] == [kept]
