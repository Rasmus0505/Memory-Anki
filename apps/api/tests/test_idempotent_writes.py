from __future__ import annotations

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.palaces.presentation import router as palaces_router
from memory_anki.modules.persistence.application.idempotency import MUTATION_ID_HEADER
from memory_anki.modules.sessions.presentation import router as sessions_router


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
