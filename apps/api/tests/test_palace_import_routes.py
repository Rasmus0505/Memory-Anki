from __future__ import annotations

import json

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace, Peg
from memory_anki.modules.produce.presentation import import_router
from memory_anki.platform.application import MUTATION_ID_HEADER


def _json_import_file(items: list[dict]) -> dict:
    return {
        "file": (
            "palaces.json",
            json.dumps(items, ensure_ascii=False).encode("utf-8"),
            "application/json",
        )
    }


@pytest.mark.skip(reason="legacy review-schedule init removed; import no longer triggers schedules")
def test_json_import_rolls_back_entire_batch_when_review_initialization_fails(
    make_client,
    session_factory,
    monkeypatch,
):
    del make_client, session_factory, monkeypatch


def test_json_import_replay_does_not_duplicate_batch(
    make_client,
    session_factory,
):
    client = make_client(import_router)
    headers = {MUTATION_ID_HEADER: "batch-import-replay"}
    items = [
        {
            "title": "First",
            "pegs": [
                {
                    "name": "Parent",
                    "content": "1",
                    "children": [{"name": "Child", "content": "2"}],
                }
            ],
        },
        {"title": "Second", "pegs": []},
    ]

    first = client.post(
        "/api/v1/import?format=json",
        files=_json_import_file(items),
        headers=headers,
    )
    second = client.post(
        "/api/v1/import?format=json",
        files=_json_import_file([{"title": "Ignored"}]),
        headers=headers,
    )

    assert first.status_code == 200
    assert first.json() == {"ok": True, "count": 2}
    assert second.json() == first.json()
    with session_factory() as session:
        assert session.query(Palace).count() == 2
        assert session.query(Peg).count() == 2


def test_invalid_json_shape_does_not_create_partial_rows(make_client, session_factory):
    client = make_client(import_router)
    response = client.post(
        "/api/v1/import?format=json",
        files={
            "file": (
                "invalid.json",
                json.dumps([{"title": "Valid"}, "invalid item"]).encode("utf-8"),
                "application/json",
            )
        },
    )

    assert response.status_code == 400
    with session_factory() as session:
        assert session.query(Palace).count() == 0
