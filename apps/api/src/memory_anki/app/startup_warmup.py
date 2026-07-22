from __future__ import annotations

import logging
import threading

from sqlalchemy import text

from memory_anki.infrastructure.db._tables._base import get_session

logger = logging.getLogger(__name__)

_warmup_started = False
_warmup_lock = threading.Lock()


def run_startup_warmup() -> None:
    """Warm the common SQLite and study-query paths without changing data."""
    session = get_session()
    try:
        connection = session.connection()
        connection.execute(text("SELECT 1")).scalar()
        connection.execute(text("PRAGMA schema_version")).scalar()
        connection.execute(text("PRAGMA journal_mode")).scalar()
        for table_name in (
            "palaces",
            "review_node_states",
            "session_progress",
        ):
            connection.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar()
        connection.execute(
            text(
                """
                SELECT id
                FROM review_node_states
                WHERE due_at <= CURRENT_TIMESTAMP
                ORDER BY due_at, palace_id, id
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
        logger.info("startup warmup completed")
    finally:
        session.close()


def _run_startup_warmup_safely() -> None:
    try:
        run_startup_warmup()
    except Exception:
        logger.exception("startup warmup failed")


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
