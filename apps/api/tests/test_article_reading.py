from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.content.application.article_reading import (
    ArticleReadingConflict,
    ArticleReadingWrite,
    get_article_reading,
    save_article_reading,
)
from memory_anki.modules.content.infrastructure.article_reading_store import (
    SqlAlchemyArticleReadingStore,
)
from memory_anki.modules.content.presentation.article_reading_router import router
from memory_anki.platform.persistence import SqlAlchemyUnitOfWork


@pytest.fixture
def session():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Config.__table__.create(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def command(**changes):
    return ArticleReadingWrite.model_validate({
        "node_uid": "stable-node", "client_id": "tab-a", "operation_id": "op-1",
        "client_sequence": 1, "expected_revision": 0, "block_offset": 0.5, **changes,
    })


def test_get_is_read_only_and_scopes_are_independent(session):
    store = SqlAlchemyArticleReadingStore(session)
    assert get_article_reading(store, "palace:1").cursor is None
    assert list(session.scalars(select(Config))) == []
    uow = SqlAlchemyUnitOfWork(session)
    first = save_article_reading(store, "palace:1", command(), uow=uow)
    assert first.cursor.revision == 1
    assert get_article_reading(store, "knowledge-subject:1").cursor is None
    assert session.scalar(select(Config.key)) == "article.reading.palace:1"


def test_monotonic_cas_and_idempotency(session):
    store = SqlAlchemyArticleReadingStore(session)
    uow = SqlAlchemyUnitOfWork(session)
    first = save_article_reading(store, "palace:1", command(), uow=uow)
    assert save_article_reading(store, "palace:1", command(), uow=Mock()) == first
    for stale in [command(operation_id="op-2"), command(operation_id="op-2", expected_revision=1), command(client_id="tab-b")]:
        with pytest.raises(ArticleReadingConflict):
            save_article_reading(store, "palace:1", stale, uow=uow)
    second = save_article_reading(store, "palace:1", command(operation_id="op-2", client_sequence=2, expected_revision=1, node_uid="earlier-node"), uow=uow)
    assert second.cursor.revision == 2
    assert second.cursor.updated_at > first.cursor.updated_at
    assert second.cursor.node_uid == "earlier-node"  # reading backwards is allowed
    with pytest.raises(ArticleReadingConflict):
        save_article_reading(store, "palace:1", command(), uow=uow)


def test_atomic_store_rejects_lost_update(session):
    store = SqlAlchemyArticleReadingStore(session)
    assert store.compare_and_set("palace:1", None, "first")
    assert not store.compare_and_set("palace:1", None, "second")
    assert not store.compare_and_set("palace:1", "old", "second")
    assert store.compare_and_set("palace:1", "first", "second")
    assert store.read("palace:1") == "second"


def test_router_contract_and_validation(session):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[session_dep] = lambda: session
    with TestClient(app) as client:
        path = "/api/v1/content/article-reading/palace:1"
        assert client.get(path).json() == {"owner_id": "palace:1", "cursor": None}
        payload = command().model_dump()
        assert client.put(path, json=payload).status_code == 200
        conflict = client.put(path, json={**payload, "operation_id": "late"})
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["remoteSnapshot"]["cursor"]["revision"] == 1
        for invalid in [{"block_offset": 1.1}, {"node_uid": ""}, {"client_sequence": 0}, {"editor_doc": {}}]:
            assert client.put(path, json={**payload, **invalid}).status_code == 422
        assert client.get("/api/v1/content/article-reading/other:1").status_code == 422
