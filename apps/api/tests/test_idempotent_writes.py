from __future__ import annotations

import pytest

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceSegment,
    PalaceTemplate,
)
from memory_anki.modules.palaces.presentation import router as palaces_router
from memory_anki.modules.palaces.presentation import (
    segment_router,
)
from memory_anki.modules.sessions.presentation import router as sessions_router
from memory_anki.platform.application import MUTATION_ID_HEADER


def test_create_study_session_replay_returns_cached_response_without_duplicate_row(
    make_client,
    session_factory,
):
    client = make_client(sessions_router)
    headers = {MUTATION_ID_HEADER: "study-session-create-0001"}
    payload = {
        "scene": "review",
        "target_type": "none",
        "title": "Replay Study Session",
    }

    first = client.post("/api/v1/study-sessions", json=payload, headers=headers)
    second = client.post(
        "/api/v1/study-sessions",
        json={**payload, "title": "Should Not Be Created"},
        headers=headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    with session_factory() as session:
        assert session.query(StudySession).count() == 1


def test_failed_create_study_session_is_not_cached(make_client, session_factory):
    client = make_client(sessions_router)
    headers = {MUTATION_ID_HEADER: "study-session-create-0002"}

    bad = client.post(
        "/api/v1/study-sessions",
        json={"scene": "", "target_type": "none", "title": "Bad"},
        headers=headers,
    )
    ok = client.post(
        "/api/v1/study-sessions",
        json={"scene": "review", "target_type": "none", "title": "Good"},
        headers=headers,
    )

    assert bad.status_code == 400
    assert ok.status_code == 200
    assert ok.json()["item"]["title"] == "Good"
    with session_factory() as session:
        assert session.query(StudySession).count() == 1


def test_create_palace_replay_returns_cached_response_without_duplicate_row(
    make_client,
    session_factory,
    monkeypatch,
):
    monkeypatch.setattr(palaces_router, "maybe_create_rolling_backup", lambda *args, **kwargs: None)
    client = make_client(palaces_router)
    headers = {MUTATION_ID_HEADER: "palace-create-0001"}
    payload = {"title": "Idempotent Palace", "description": "", "pegs": []}

    first = client.post("/api/v1/palaces", json=payload, headers=headers)
    second = client.post(
        "/api/v1/palaces",
        json={**payload, "title": "Should Not Be Created"},
        headers=headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    with session_factory() as session:
        assert session.query(Palace).count() == 1


@pytest.mark.skip(reason="trigger_review_for_palace removed with legacy schedules")
def test_create_palace_rolls_back_when_initial_review_creation_fails(
    make_client,
    session_factory,
    monkeypatch,
):
    del make_client, session_factory, monkeypatch


def test_create_segment_rolls_back_when_idempotency_record_fails(
    make_client,
    session_factory,
    monkeypatch,
):
    monkeypatch.setattr(palaces_router, "maybe_create_rolling_backup", lambda *args, **kwargs: None)
    client = make_client(palaces_router)
    palace_id = client.post(
        "/api/v1/palaces",
        json={"title": "Segment Owner", "description": "", "pegs": []},
    ).json()["id"]
    monkeypatch.setattr(
        segment_router.SqlAlchemyMutationResponseStore,
        "save",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("cache failed")),
    )

    with pytest.raises(RuntimeError, match="cache failed"):
        client.post(
            f"/api/v1/palaces/{palace_id}/segments",
            json={"name": "Must Roll Back"},
            headers={MUTATION_ID_HEADER: "segment-create-rollback"},
        )

    with session_factory() as session:
        assert session.query(PalaceSegment).filter_by(palace_id=palace_id).count() == 0


def _seed_palace_template(session_factory, name: str = "Atomic Template") -> int:
    with session_factory() as session:
        template = PalaceTemplate(
            name=name,
            description="",
            editor_doc='{"root":{"data":{"text":"Template"},"children":[]}}',
            editor_config="",
        )
        session.add(template)
        session.commit()
        return template.id


@pytest.mark.skip(reason="trigger_review_for_palace removed with legacy schedules")
def test_template_instantiation_rolls_back_when_review_creation_fails(
    make_client,
    session_factory,
    monkeypatch,
):
    del make_client, session_factory, monkeypatch


def test_template_instantiation_replay_does_not_duplicate_palace(
    make_client,
    session_factory,
):
    template_id = _seed_palace_template(session_factory)
    client = make_client(palaces_router)
    headers = {MUTATION_ID_HEADER: "template-instantiate-replay"}

    first = client.post(
        f"/api/v1/palace-templates/{template_id}/instantiate",
        json={"title": "First Title"},
        headers=headers,
    )
    second = client.post(
        f"/api/v1/palace-templates/{template_id}/instantiate",
        json={"title": "Ignored Title"},
        headers=headers,
    )

    assert first.status_code == 200
    assert second.json() == first.json()
    with session_factory() as session:
        assert session.query(Palace).count() == 1
