from __future__ import annotations

import json
from datetime import datetime

import pytest

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.modules.sessions.presentation import router as sessions_router
from memory_anki.platform.application import MUTATION_ID_HEADER


def _seed_session(session_factory, session_id: str) -> None:
    with session_factory() as session:
        session.add(
            StudySession(
                id=session_id,
                status="active",
                scene="review",
                target_type="none",
                title="Seed",
                started_at=datetime(2026, 7, 11, 9, 0, 0),
                progress_json="{}",
                events_json="[]",
                summary_json="{}",
            )
        )
        session.commit()


def _fail_mutation_store(monkeypatch) -> None:
    monkeypatch.setattr(
        sessions_router.SqlAlchemyMutationResponseStore,
        "save",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("cache failed")),
    )


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/v1/study-sessions",
            {"id": "create-rollback", "scene": "review", "target_type": "none"},
        ),
        (
            "/api/v1/study-sessions/from-time-record",
            {
                "id": "time-rollback",
                "kind": "practice",
                "startedAt": "2026-07-11T10:00:00",
                "endedAt": "2026-07-11T10:10:00",
                "effectiveSeconds": 600,
            },
        ),
    ],
)
def test_create_mutation_store_failure_rolls_back_new_session(
    make_client, session_factory, monkeypatch, path, payload
):
    _fail_mutation_store(monkeypatch)
    client = make_client(sessions_router)

    with pytest.raises(RuntimeError, match="cache failed"):
        client.post(
            path,
            json=payload,
            headers={MUTATION_ID_HEADER: f"rollback-{payload['id']}"},
        )

    with session_factory() as session:
        assert session.get(StudySession, payload["id"]) is None


@pytest.mark.parametrize(
    ("suffix", "payload"),
    [
        ("events", {"events": [{"type": "checkpoint"}]}),
        ("complete", {"effective_seconds": 120, "completion_method": "done"}),
        ("abandon", {"completion_method": "cancelled"}),
    ],
)
def test_existing_session_mutation_store_failure_restores_original_state(
    make_client, session_factory, monkeypatch, suffix, payload
):
    session_id = f"{suffix}-rollback"
    _seed_session(session_factory, session_id)
    _fail_mutation_store(monkeypatch)
    client = make_client(sessions_router)

    with pytest.raises(RuntimeError, match="cache failed"):
        client.post(
            f"/api/v1/study-sessions/{session_id}/{suffix}",
            json=payload,
            headers={MUTATION_ID_HEADER: f"rollback-{suffix}"},
        )

    with session_factory() as session:
        row = session.get(StudySession, session_id)
        assert row is not None
        assert row.status == "active"
        assert json.loads(row.events_json) == []
        assert row.effective_seconds == 0
        assert row.completion_method == ""


def test_time_record_replay_does_not_duplicate_session(make_client, session_factory):
    client = make_client(sessions_router)
    headers = {MUTATION_ID_HEADER: "time-record-replay"}
    payload = {
        "id": "time-replay",
        "kind": "practice",
        "startedAt": "2026-07-11T10:00:00",
        "endedAt": "2026-07-11T10:10:00",
        "effectiveSeconds": 600,
    }

    first = client.post(
        "/api/v1/study-sessions/from-time-record", json=payload, headers=headers
    )
    second = client.post(
        "/api/v1/study-sessions/from-time-record",
        json={**payload, "effectiveSeconds": 1},
        headers=headers,
    )

    assert second.json() == first.json()
    with session_factory() as session:
        assert session.query(StudySession).count() == 1
        assert session.get(StudySession, "time-replay").effective_seconds == 600


@pytest.mark.parametrize(
    ("suffix", "first_payload", "second_payload"),
    [
        (
            "events",
            {"events": [{"type": "first"}]},
            {"events": [{"type": "second"}]},
        ),
        (
            "complete",
            {"effective_seconds": 120, "completion_method": "first"},
            {"effective_seconds": 1, "completion_method": "second"},
        ),
        (
            "abandon",
            {"completion_method": "first"},
            {"completion_method": "second"},
        ),
    ],
)
def test_existing_session_mutation_replay_preserves_first_result(
    make_client, session_factory, suffix, first_payload, second_payload
):
    session_id = f"{suffix}-replay"
    _seed_session(session_factory, session_id)
    client = make_client(sessions_router)
    headers = {MUTATION_ID_HEADER: f"replay-{suffix}"}

    first = client.post(
        f"/api/v1/study-sessions/{session_id}/{suffix}",
        json=first_payload,
        headers=headers,
    )
    second = client.post(
        f"/api/v1/study-sessions/{session_id}/{suffix}",
        json=second_payload,
        headers=headers,
    )

    assert second.json() == first.json()
    with session_factory() as session:
        row = session.get(StudySession, session_id)
        assert row is not None
        if suffix == "events":
            assert json.loads(row.events_json) == [{"type": "first"}]
        elif suffix == "complete":
            assert row.effective_seconds == 120
            assert row.completion_method == "first"
        else:
            assert row.completion_method == "first"
