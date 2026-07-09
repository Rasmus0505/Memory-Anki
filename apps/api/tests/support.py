"""Shared infrastructure for unittest.TestCase route tests."""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db._tables import Base


class RouterTestCase(unittest.TestCase):
    """Create an in-memory database, mount routers, and override DB dependencies."""

    ROUTER_MODULES: tuple = ()

    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)

        app = FastAPI()

        def override_session_dep():
            session = self.SessionLocal()
            try:
                yield session
            finally:
                session.close()

        for module in self.ROUTER_MODULES:
            app.include_router(module.router, prefix="/api/v1")
            app.dependency_overrides[module.session_dep] = override_session_dep
        self.app = app
        self.client = TestClient(app)

        with self.SessionLocal() as session:
            self.seed(session)

    def seed(self, session):
        """Hook for subclasses to insert seed data."""

    def tearDown(self):
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()
