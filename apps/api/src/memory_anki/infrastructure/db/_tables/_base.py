"""Shared declarative base, engine, and session factory for all ORM tables.

All domain table modules import ``Base`` and the column helpers from here so
they register against a single ``Base.metadata``. The engine is created eagerly
at import time to preserve the historical behaviour expected by callers of
``get_session`` / ``init_db`` in ``infrastructure.db.models``.
"""

from __future__ import annotations

import sqlite3

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session

from memory_anki.core.config import DATABASE_URL, ensure_runtime_dirs
from memory_anki.infrastructure.db.migrations import run_migrations

ensure_runtime_dirs()
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _configure_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    if not isinstance(dbapi_connection, sqlite3.Connection):
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA journal_mode=WAL")
    finally:
        cursor.close()


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    run_migrations()


def get_session() -> Session:
    return Session(engine)
