"""API tests for server-side 未保存 rating intents (shared across devices)."""

from __future__ import annotations

import json

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


def test_an_attempt_a_later_practice_replaced_is_dropped_instead_of_listed(db_session):
    """A dead intent can never be written: listing it keeps 未保存 and a 400 重试 alive."""
    from memory_anki.infrastructure.db._tables.misc import FreestyleRatingIntent
    from memory_anki.infrastructure.db._tables.palaces import Palace
    from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
    from memory_anki.modules.memory.application.unit_review_service import (
        close_unit_review_encounter,
        rate_review_unit,
        reconcile_palace_units,
        start_freestyle_unit_review_session,
    )
    from memory_anki.modules.practice.application.rating_intents import (
        list_rating_intents,
        put_rating_intent,
    )

    palace = Palace(
        title="intent palace",
        archived=False,
        editor_doc=json.dumps({
            "root": {
                "data": {"uid": "root", "text": "intent palace", "permanentSplitMark": True},
                "children": [{"data": {"uid": "node-a", "text": "节点 A"}, "children": []}],
            }
        }, ensure_ascii=False),
    )
    db_session.add(palace)
    db_session.commit()
    reconcile_palace_units(db_session, palace.id)
    db_session.commit()
    state = (
        db_session.query(ReviewUnitState)
        .filter_by(palace_id=palace.id, active=True)
        .one()
    )

    def rate_attempt(slot: str, rating: int) -> None:
        session = start_freestyle_unit_review_session(
            db_session,
            unit_id=state.id,
            unit_revision=state.revision,
            encounter_id=f"enc-{slot}",
            round_id=ROUND,
            card_id=f"card-{slot}",
        )
        rate_review_unit(
            db_session,
            study_session_id=session["id"],
            unit_id=state.id,
            unit_revision=state.revision,
            encounter_id=f"enc-{slot}",
            operation_id=f"op-{slot}",
            rating=rating,
            round_id=ROUND,
            card_id=f"card-{slot}",
        )
        close_unit_review_encounter(
            db_session,
            study_session_id=session["id"],
            unit_id=state.id,
            encounter_id=f"enc-{slot}",
            operation_id=f"op-{slot}:close",
        )

    rate_attempt("a", 2)
    rate_attempt("b", 3)

    put_rating_intent(
        db_session,
        round_id=ROUND,
        card_id="card-a",
        operation_id="intent-a",
        rating=3,
        failure="network",
        payload={"card_id": "card-a", "unit_id": state.id, "encounter_id": "never-created"},
    )
    assert db_session.query(FreestyleRatingIntent).filter_by(round_id=ROUND).count() == 1

    assert list_rating_intents(db_session, round_id=ROUND) == []
    assert db_session.query(FreestyleRatingIntent).filter_by(round_id=ROUND).count() == 0
