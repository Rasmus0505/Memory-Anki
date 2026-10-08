"""Shared declarative base, engine, and session factory for all ORM tables.

All domain table modules import ``Base`` and the column helpers from here so
they register against a single ``Base.metadata``. The engine is created eagerly
at import time to preserve the historical behaviour expected by callers of
``get_session`` / ``init_db`` in ``infrastructure.db.models``.
"""

from __future__ import annotations

import logging
import sqlite3
import time

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session

from memory_anki.core.config import DATABASE_URL, ensure_runtime_dirs
from memory_anki.core.runtime_storage_lock import storage_write_lock
from memory_anki.infrastructure.db.diagnostics import (
    finish_connection_timer,
    install_query_diagnostics,
    start_connection_timer,
)
from memory_anki.infrastructure.db.migrations import run_migrations

logger = logging.getLogger(__name__)

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
    start_connection_timer(_conn_rec)
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
        finish_connection_timer(_connection_record)


install_query_diagnostics(engine)


def _release_storage_lock(session: Session) -> None:
    lock = session.info.pop("_storage_write_lock", None)
    if lock is not None:
        lock.__exit__(None, None, None)


@event.listens_for(Session, "before_flush")
def _acquire_storage_lock(session: Session, _flush_context, _instances) -> None:
    """Take the shared runtime lock only for the duration of the SQL flush.

    Ledger and backup writers take the same lock, and a backup must never copy a
    half-written row. That is a *flush-scoped* requirement: the bytes are on disk
    once ``flush`` returns, so holding the lock past that point protects nothing
    and costs everything.

    It previously spanned the whole transaction (acquired here, released on
    ``after_transaction_end``). Any handler that flushed early and then did slow
    non-SQL work therefore held the single process-wide lock for its entire
    remaining runtime, and every other writer queued behind it. Measured on the
    owner's machine this produced 314 `storage_busy` 503s in one day, clustered
    on the rating path, with the handler reporting ~28ms of SQL and a 15000ms
    lock wait. See docs/architecture/storage-lock-contention.md.

    The lock is still held across the flush itself and across any nested flush,
    so a concurrent snapshot can never observe a partial write.
    """
    if session.info.get("_storage_write_lock") is not None:
        # Already held by an enclosing flush (re-entrant use, or a flush that
        # triggers another flush through an event handler).
        return
    if not (session.new or session.dirty or session.deleted):
        return
    lock = storage_write_lock()
    lock.__enter__()
    session.info["_storage_write_lock"] = lock


@event.listens_for(Session, "after_flush")
def _release_storage_lock_after_flush(session: Session, _flush_context) -> None:
    """Release once the SQL statement has actually been emitted.

    ``after_flush`` runs after the statements are sent to the DBAPI but *before*
    ``commit``, which is exactly the window a backup snapshot must be excluded
    from. Anything the handler does afterwards (building a response payload,
    serializing a mindmap, computing the next queue) no longer blocks writers.
    """
    _release_storage_lock(session)


@event.listens_for(Session, "after_transaction_end")
def _release_storage_lock_after_transaction(session: Session, transaction) -> None:
    # Defensive: a flush that raises leaves the lock attached to the session,
    # and the rollback path ends the transaction without an ``after_flush``.
    if getattr(transaction, "parent", None) is not None:
        return
    _release_storage_lock(session)


# ── Open-write-transaction watchdog ───────────────────────────────────────────
#
# SQLite (WAL) allows many concurrent readers but exactly ONE writer. A write
# transaction left open across slow non-SQL work therefore blocks every other
# writer for `busy_timeout` (10s) and then fails them with "database is locked",
# which reaches the learner as a dead rating bar.
#
# The app-level runtime lock does NOT cover this window: it is released per flush
# (see _release_storage_lock_after_flush) while SQLite keeps the transaction open
# until commit/rollback. So the guard has to observe the transaction, not the
# lock.
#
# WHY THIS WATCHDOG WAS REWRITTEN (2026-10-07)
# -------------------------------------------
# The first version timed from ``after_begin`` and reported every transaction
# ending after 3s as "write transaction held ... opened at <frame>". Two defects
# made it actively misleading, and both were proven by experiment rather than
# inferred:
#
#  1. ``after_begin`` fires for READ-ONLY transactions too. A probe on a scratch
#     database showed a session that only ran ``SELECT 1`` starting the timer
#     with no origin recorded -- i.e. a read reported as a write, logged as
#     "opened at unknown".
#  2. For a CONTENDED write, the transaction's duration is dominated by the
#     ``busy_timeout`` wait, and the origin frame is where *that* request tried
#     to write. So a blocked victim was reported as the holder. Production logs
#     show the result: `DELETE ... failed=True` after 10847ms was reported as
#     "write transaction held 14.83s opened at ..._delete_open_unrated_encounters"
#     -- naming the victim of the lock as its owner, on the very line that was
#     waiting for it.
#
# That is why three rounds of fixes aimed at the named frames did not stop the
# failure: the instrument pointed at whatever was blocked, not at whatever was
# holding. The rewritten watchdog separates the two cases explicitly, and only
# starts timing once the session actually stages a write.
#
# Cost when healthy: two perf_counter() reads per writing transaction, nothing at
# all for reads.
OPEN_WRITE_TRANSACTION_WARN_SECONDS = 3.0

_WRITE_TXN_STARTED = "_write_txn_started_at"
_WRITE_TXN_ORIGIN = "_write_txn_origin"
_WRITE_TXN_ATTEMPTED = "_write_txn_attempted"
_WRITE_TXN_FLUSHED = "_write_txn_flushed"


def _describe_opening_frame() -> str:
    """The innermost frame that is not database machinery or stdlib.

    Walks the stack and returns the first frame that belongs to this project.
    Both the app package (``.../src/memory_anki/...``) and the test tree
    (``.../tests/...``) count, so the same helper works in production and in the
    regression test that pins it. SQLAlchemy internals, ``site-packages`` and the
    standard library are skipped: reporting ``_connection_for_bind`` would name
    the mechanism rather than the caller, and only the caller can be fixed.
    """
    import sysconfig
    import traceback

    stdlib = (sysconfig.get_paths().get("stdlib") or "").replace("\\", "/")
    for frame in reversed(traceback.extract_stack()):
        filename = frame.filename.replace("\\", "/")
        if "site-packages" in filename or "/memory_anki/infrastructure/db/" in filename:
            continue
        if stdlib and filename.startswith(stdlib):
            continue
        if filename.startswith("<"):
            continue
        if "/memory_anki/" in filename:
            return f"{filename.rsplit('/src/', 1)[-1]}:{frame.lineno} in {frame.name}"
        return f"{filename.rsplit('/', 2)[-2]}/{filename.rsplit('/', 1)[-1]}:{frame.lineno} in {frame.name}"
    return "unknown (no application frame)"


@event.listens_for(Session, "before_flush")
def _record_write_transaction_origin(session: Session, _flush_context, _instances) -> None:
    """Record that this session is *about* to write, and from where.

    Two things happen here, and the distinction between them is the whole point
    of the rewrite:

    * ``_write_txn_attempted`` marks the moment we are about to ask SQLite for the
      write lock. The gap between this and the moment the flush returns is *time
      spent waiting*, which is what a blocked victim experiences -- not something
      the victim is doing to anybody else.
    * ``_write_txn_origin`` remembers the issuing frame, so a report can name the
      call site. It is captured on the first flush only: that is the write that
      opened the transaction, and later flushes in the same transaction are
      consequences of it.

    Captured here rather than in ``after_begin`` because that event fires from
    inside SQLAlchemy's connection-bind machinery, where the stack names the
    mechanism (``_connection_for_bind``) instead of the call site -- and because
    ``after_begin`` cannot tell a read from a write at all.
    """
    if not (session.new or session.dirty or session.deleted):
        # Nothing staged: this flush emits no DML and takes no write lock.
        return
    now = time.perf_counter()
    if session.info.get(_WRITE_TXN_ATTEMPTED) is None:
        session.info[_WRITE_TXN_ATTEMPTED] = now
    if session.info.get(_WRITE_TXN_ORIGIN) is None:
        session.info[_WRITE_TXN_ORIGIN] = _describe_opening_frame()


@event.listens_for(Session, "after_flush")
def _mark_write_lock_acquired(session: Session, _flush_context) -> None:
    """The DML has reached the DBAPI, so SQLite now holds the write lock.

    This is the start of the interval that matters: the lock is held from the
    first successfully emitted write until commit/rollback. A handler that flushes
    early and then does slow non-SQL work holds it for all of that work, and every
    other writer in the process waits out ``busy_timeout`` behind it.

    Only reached when a flush actually completed, so a flush that timed out in
    ``busy_timeout`` (a *victim* of the lock) never gets here and can never be
    mistaken for the holder.
    """
    if session.info.get(_WRITE_TXN_ATTEMPTED) is None:
        return
    session.info.setdefault(_WRITE_TXN_STARTED, time.perf_counter())
    session.info[_WRITE_TXN_FLUSHED] = True


@event.listens_for(Session, "after_transaction_end")
def _report_slow_write_transaction(session: Session, transaction) -> None:
    if getattr(transaction, "parent", None) is not None:
        return
    attempted_at = session.info.pop(_WRITE_TXN_ATTEMPTED, None)
    held_from = session.info.pop(_WRITE_TXN_STARTED, None)
    flushed = session.info.pop(_WRITE_TXN_FLUSHED, None)
    origin = session.info.pop(_WRITE_TXN_ORIGIN, None)
    if attempted_at is None:
        return

    emitted_at = time.perf_counter()
    if held_from is not None:
        held = emitted_at - held_from
        waited = held_from - attempted_at
    else:
        # Never got the lock: this transaction is a victim, not a holder.
        held = 0.0
        waited = emitted_at - attempted_at

    if held < OPEN_WRITE_TRANSACTION_WARN_SECONDS:
        if waited >= OPEN_WRITE_TRANSACTION_WARN_SECONDS and not flushed:
            # Blocked on the write lock for a long time and never got it. This is
            # the signature the previous version mislabelled as the cause.
            logger.warning(
                "blocked %.2fs WITHOUT ever acquiring the write lock at %s "
                "(another connection held it; this call site is a victim, not the holder)",
                waited,
                origin or "unknown",
            )
        return

    logger.warning(
        "write transaction HELD %.2fs (after waiting %.2fs for the lock) opened at %s "
        "(SQLite allows one writer; other writers block for busy_timeout then fail)",
        held,
        waited,
        origin or "unknown",
    )


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    run_migrations()


def get_session() -> Session:
    return Session(engine)