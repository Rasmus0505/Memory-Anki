"""Shared declarative base, engine, and session factory for all ORM tables.

All domain table modules import ``Base`` and the column helpers from here so
they register against a single ``Base.metadata`` (required for
``create_all`` to build every table). The engine is created eagerly at import
time to preserve the historical behaviour expected by callers of
``get_session`` / ``init_db`` in ``infrastructure.db.models``.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session

from memory_anki.core.config import DATABASE_URL, ensure_runtime_dirs

ensure_runtime_dirs()
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)
