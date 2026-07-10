"""apps/api/tests shared fixtures."""
import os
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

_TEST_APP_HOME = Path(tempfile.mkdtemp(prefix="memory-anki-tests-"))
os.environ["MEMORY_ANKI_HOME"] = str(_TEST_APP_HOME)
os.environ["MEMORY_ANKI_WEB_DIST"] = ""
for _key in (
    "DASHSCOPE_API_KEY",
    "ZHIPU_API_KEY",
    "SILICONFLOW_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
):
    os.environ[_key] = ""


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TEST_APP_HOME, ignore_errors=True)


@pytest.fixture()
def test_engine():
    from memory_anki.infrastructure.db._tables import Base

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
