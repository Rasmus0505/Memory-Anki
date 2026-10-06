from __future__ import annotations

from memory_anki.platform.application import (
    MUTATION_ID_HEADER,
    MutationIdentity,
    mutation_identity_from_headers,
    open_mutation_replay,
)
from memory_anki.platform.persistence import SqlAlchemyMutationResponseStore


def test_mutation_identity_is_framework_independent_header_mapping():
    assert mutation_identity_from_headers({}) is None
    assert mutation_identity_from_headers({MUTATION_ID_HEADER: "   "}) is None
    assert mutation_identity_from_headers({MUTATION_ID_HEADER: "x" * 81}) is None
    assert mutation_identity_from_headers({MUTATION_ID_HEADER: " operation-1 "}) == (
        MutationIdentity(operation_id="operation-1")
    )


def test_sqlalchemy_mutation_store_roundtrip_without_owning_commit(db_session):
    store = SqlAlchemyMutationResponseStore(db_session)
    identity = MutationIdentity(operation_id="platform-roundtrip")

    store.save(identity, {"ok": True, "value": 3})

    assert store.get(identity) == {"ok": True, "value": 3}
    db_session.rollback()
    assert store.get(identity) is None


def test_sqlalchemy_mutation_store_ignores_missing_identity(db_session):
    store = SqlAlchemyMutationResponseStore(db_session)

    store.save(None, {"ok": True})

    assert store.get(None) is None


def test_open_mutation_replay_binds_identity_from_headers(db_session):
    store = SqlAlchemyMutationResponseStore(db_session)

    replay = open_mutation_replay(store, {MUTATION_ID_HEADER: "replay-1"})

    assert replay.identity == MutationIdentity(operation_id="replay-1")
    assert replay.existing() is None


def test_open_mutation_replay_without_identity_never_replays(db_session):
    store = SqlAlchemyMutationResponseStore(db_session)
    # Nothing can be stored under a missing identity, so a request without the
    # header must never be answered from a stored response.
    replay = open_mutation_replay(store, {})
    assert replay.identity is None

    replay.save({"ok": True})

    assert replay.existing() is None
    assert store.get(None) is None


def test_open_mutation_replay_returns_exactly_the_stored_payload(db_session):
    store = SqlAlchemyMutationResponseStore(db_session)
    identity = MutationIdentity(operation_id="replay-2")

    replay = open_mutation_replay(store, {MUTATION_ID_HEADER: "replay-2"})
    replay.save({"item": {"id": 7}, "extra": [1, 2]})

    # The helper does no response shaping: a replay returns the same bytes the
    # original response persisted.
    assert replay.existing() == {"item": {"id": 7}, "extra": [1, 2]}
    assert store.get(identity) == {"item": {"id": 7}, "extra": [1, 2]}
