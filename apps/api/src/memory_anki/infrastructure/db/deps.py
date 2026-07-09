"""FastAPI route shared database session dependencies.

All presentation routers import ``session_dep`` from this module.
Tests may override FastAPI dependencies or replace this module's
``get_session`` attribute when a session factory monkeypatch is needed.
"""
from __future__ import annotations

from memory_anki.infrastructure.db._tables import get_session


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()
