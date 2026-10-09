from __future__ import annotations

import logging
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
