"""apps/api/tests shared fixtures."""
from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db._tables import Base


@pytest.fixture()
def test_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture()
def db_session(session_factory):
    session = session_factory()
    yield session
    session.close()


@pytest.fixture()
def make_client(session_factory) -> Callable[..., TestClient]:
    def _make(*router_modules) -> TestClient:
        app = FastAPI()

        def override_session_dep():
            session = session_factory()
            try:
                yield session
            finally:
                session.close()

        for module in router_modules:
            app.include_router(module.router, prefix="/api/v1")
            app.dependency_overrides[module.session_dep] = override_session_dep
        return TestClient(app)

    return _make
