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

# How long a writer waits for a contended SQLite lock before raising
# "database is locked". Keep it *below* the client's transport budgets
# (apps/web/src/shared/api/http.ts: 20s reads, 15s session-start POST) so a real
# lock error reaches the browser as an actionable message instead of the generic
# "请求超过 N 秒未响应" that the client-side timeout would otherwise raise.
SQLITE_LOCK_WAIT_SECONDS = 10

# How long a request waits for a pooled connection before giving up. This is the
# *innermost* timeout in the stack and must stay well below every client budget:
#   pool_timeout (5s) < SQLITE_LOCK_WAIT_SECONDS (10s) < 15s session-start POST
#                       < 20s reads < 30s app-level session load
# Leaving it unset means SQLAlchemy's 30s default, which is slower than all four
# client budgets — a saturated pool then parks every request for 30s and returns
# a burst of 500s *after* the browser already gave up, so the client and server
# disagree about whether the write happened. Failing fast keeps pool exhaustion
# an actionable, retryable error. See docs/architecture/read-models.md.
DB_POOL_TIMEOUT_SECONDS = 5

# Pool sizing. A single freestyle feed open fans out into a burst of concurrent
# reads (review queue, several palace projections, ladder progress, quiz-node
# bindings, dashboard, grouped summary) while the card carousel keeps POSTing
# session starts. With pool_size=5/max_overflow=2 a 7-connection ceiling, that
# burst starved the pool completely. SQLite serialises writes itself
# (busy_timeout + WAL allows many concurrent readers alongside one writer), so
# the pool is mostly a reader-concurrency budget; oversize it rather than let
# requests queue behind a 7-slot limit on a local single-user database.
DB_POOL_SIZE = 10
DB_MAX_OVERFLOW = 20

# pool_pre_ping is unnecessary for a local file DB.
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": SQLITE_LOCK_WAIT_SECONDS},
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=DB_POOL_TIMEOUT_SECONDS,
    pool_pre_ping=False,
)


@event.listens_for(engine, "do_connect")
def _ensure_dirs_before_connect(_dialect, _conn_rec, _cargs, _cparams) -> None:
    ensure_runtime_dirs()


@event.listens_for(engine, "connect")
def _configure_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    if not isinstance(dbapi_connection, sqlite3.Connection):
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_LOCK_WAIT_SECONDS * 1000}")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA journal_mode=WAL")
        # ~64MB page cache reduces USB random reads for hot indexes.
        cursor.execute("PRAGMA cache_size=-64000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.execute("PRAGMA mmap_size=268435456")
    finally:
        cursor.close()


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    run_migrations()


def get_session() -> Session:
    return Session(engine)
