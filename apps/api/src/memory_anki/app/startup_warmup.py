from __future__ import annotations

import logging
import os
import threading

from sqlalchemy import text

from memory_anki.infrastructure.db._tables._base import get_session
from memory_anki.modules.memory.api import repair_absurd_due_dates, warm_unit_projection_cache
from memory_anki.modules.memory.application.unit_reconcile_scheduler import drain_once

logger = logging.getLogger(__name__)

_warmup_started = False
_warmup_lock = threading.Lock()


def run_startup_warmup() -> None:
    """Warm study-query paths, and pull absurd future due dates back to today."""
    session = get_session()
    try:
        repaired = repair_absurd_due_dates(session)
        if repaired:
            session.commit()
        connection = session.connection()
        connection.execute(text("SELECT 1")).scalar()
        connection.execute(text("PRAGMA schema_version")).scalar()
        connection.execute(text("PRAGMA journal_mode")).scalar()
        for table_name in (
            "palaces",
            "review_unit_states",
            "study_sessions",
        ):
            connection.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar()
        connection.execute(
            text(
                """
                SELECT id
                FROM review_unit_states
                WHERE active = 1 AND due_date <= CURRENT_DATE
                ORDER BY due_date, palace_id, id
                LIMIT 8
                """
            )
        ).fetchall()
        # Touch active-palace list path used by freestyle / queue batch loads.
        connection.execute(
            text(
                """
                SELECT id
                FROM palaces
                WHERE deleted_at IS NULL AND archived = 0
                ORDER BY group_sort_order ASC, id ASC
                LIMIT 8
                """
            )
        ).fetchall()
        # Shelf, dashboard and review queue all re-project palace documents; warming
        # the content-keyed memo moves that ~1s off the first user request.
        warmed = warm_unit_projection_cache(session)
        # Drain any palaces whose unit hashes lagged while the app was closed. The
        # read path defers instead of rebuilding in-request, so this is where that
        # work actually lands -- off the request path and without holding the
        # global storage lock across a user-visible call.
        drained = drain_once(limit=8)
        logger.info(
            "startup warmup completed",
            extra={"warmed_palaces": warmed, "reconciled": drained.get("reconciled", 0)},
        )
    finally:
        session.close()


def _run_startup_warmup_safely() -> None:
    try:
        run_startup_warmup()
    except Exception:
        logger.exception("startup warmup failed")


def _warm_time_ledger() -> None:
    try:
        from memory_anki.infrastructure.time_ledger_store import read_intervals

        read_intervals()
    except Exception:
        logger.exception("time ledger warmup failed")


def start_ledger_prefetch() -> threading.Thread | None:
    """Fold the time ledger off the request path.

    The desktop/PWA process starts in healthcheck mode, so the serve-only warmup
    never runs there. The dashboard still reads this ledger on every open.
    """
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return None
    thread = threading.Thread(
        target=_warm_time_ledger,
        name="memory-anki-ledger-prefetch",
        daemon=True,
    )
    thread.start()
    return thread


def _warm_db_pool() -> None:
    """Open pooled connections so the first user request does not pay for it.

    Opening the database is a cold, first-touch read of a ~200MB file on the
    (often synced or USB-backed) data drive. When several requests arrive at
    once on a cold process they all park in ``do_connect`` behind that one open
    and finish together -- the log signature is a burst of unrelated endpoints
    all reporting ``connect_total_ms`` around the same multi-second value while
    ``sql_total_ms`` stays in the single digits. Warming a few connections here
    moves that cost to startup instead of a user-visible request.
    """
    from memory_anki.infrastructure.db._tables._base import DB_POOL_SIZE, engine

    # Hold them open simultaneously: the point is to fill the pool, not to open
    # and release one connection at a time.
    count = max(1, DB_POOL_SIZE)
    connections = []
    try:
        for _ in range(count):
            connection = engine.connect()
            connection.execute(text("SELECT 1")).scalar()
            connections.append(connection)
    except Exception:
        logger.exception("database pool warmup failed")
    finally:
        for connection in connections:
            try:
                connection.close()
            except Exception:
                logger.debug("failed to close warmup connection", exc_info=True)


def start_db_pool_warmup() -> threading.Thread | None:
    """Pre-open the SQLAlchemy pool off the request path."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return None
    thread = threading.Thread(
        target=_warm_db_pool,
        name="memory-anki-db-pool-warmup",
        daemon=True,
    )
    thread.start()
    return thread


def start_startup_warmup() -> threading.Thread | None:
    global _warmup_started
    with _warmup_lock:
        if _warmup_started:
            return None
        _warmup_started = True

    thread = threading.Thread(
        target=_run_startup_warmup_safely,
        name="memory-anki-startup-warmup",
        daemon=True,
    )
    thread.start()
    return thread


def reset_startup_warmup_for_test() -> None:
    global _warmup_started
    with _warmup_lock:
        _warmup_started = False
