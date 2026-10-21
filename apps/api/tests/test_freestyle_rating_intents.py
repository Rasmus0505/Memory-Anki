"""API tests for server-side 未保存 rating intents (shared across devices)."""

from __future__ import annotations

from memory_anki.modules.practice.presentation import router as freestyle_router

ROUND = "round-intent-test"
CARD = "review_unit:unit-a:r3"


def _body(operation_id: str = "op-1", rating: int = 3, **extra):
    return {
        "operation_id": operation_id,
        "rating": rating,
        "failure": "network",
        "payload": {"operation_id": operation_id, "rating": rating, "card_id": CARD},
        **extra,
    }


def test_put_then_list_returns_the_unsaved_grade_for_any_device(make_client):
    client = make_client(freestyle_router)
    put = client.put(f"/api/v1/freestyle/rounds/{ROUND}/rating-intents/{CARD}", json=_body())
    assert put.status_code == 200, put.text
    assert put.json()["item"]["rating"] == 3

    listed = client.get(f"/api/v1/freestyle/rounds/{ROUND}/rating-intents").json()["items"]
    assert [(item["card_id"], item["rating"], item["operation_id"]) for item in listed] == [(CARD, 3, "op-1")]
    assert listed[0]["payload"]["card_id"] == CARD


def test_a_newer_tap_replaces_the_older_intent_for_the_same_card(make_client):
    client = make_client(freestyle_router)
    url = f"/api/v1/freestyle/rounds/{ROUND}/rating-intents/{CARD}"
    client.put(url, json=_body("op-old", 2))
    client.put(url, json=_body("op-new", 4))

    listed = client.get(f"/api/v1/freestyle/rounds/{ROUND}/rating-intents").json()["items"]
    assert len(listed) == 1
    assert (listed[0]["operation_id"], listed[0]["rating"]) == ("op-new", 4)


def test_clear_removes_only_the_matching_operation(make_client):
    client = make_client(freestyle_router)
    url = f"/api/v1/freestyle/rounds/{ROUND}/rating-intents/{CARD}"
    client.put(url, json=_body("op-new", 4))

    stale = client.delete(url, params={"operation_id": "op-old"}).json()
    assert stale == {"cleared": False}
    assert client.get(f"/api/v1/freestyle/rounds/{ROUND}/rating-intents").json()["items"]

    done = client.delete(url, params={"operation_id": "op-new"}).json()
    assert done == {"cleared": True}
    assert client.get(f"/api/v1/freestyle/rounds/{ROUND}/rating-intents").json()["items"] == []


def test_intents_are_scoped_to_their_round(make_client):
    client = make_client(freestyle_router)
    client.put(f"/api/v1/freestyle/rounds/{ROUND}/rating-intents/{CARD}", json=_body())
    other = client.get("/api/v1/freestyle/rounds/another-round/rating-intents").json()["items"]
    assert other == []


def test_rejects_out_of_range_rating_and_oversized_payload(make_client):
    client = make_client(freestyle_router)
    url = f"/api/v1/freestyle/rounds/{ROUND}/rating-intents/{CARD}"
    assert client.put(url, json=_body(rating=9)).status_code == 422
    huge = _body(payload={"blob": "x" * 9000})
    assert client.put(url, json=huge).status_code == 400
