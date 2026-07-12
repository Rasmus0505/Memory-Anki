from __future__ import annotations

from memory_anki.platform.application import (
    MUTATION_ID_HEADER,
    MutationIdentity,
    mutation_identity_from_headers,
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
