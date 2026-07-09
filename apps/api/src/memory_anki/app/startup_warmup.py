from __future__ import annotations

import logging
import threading
from datetime import date

from sqlalchemy import text

from memory_anki.infrastructure.db._tables._base import get_session

logger = logging.getLogger(__name__)

_warmup_started = False
_warmup_lock = threading.Lock()


def run_startup_warmup() -> None:
    """Warm the common SQLite and study-query paths without changing data."""
    today = date.today().isoformat()
    session = get_session()
    try:
        connection = session.connection()
        connection.execute(text("SELECT 1")).scalar()
        connection.execute(text("PRAGMA schema_version")).scalar()
        connection.execute(text("PRAGMA journal_mode")).scalar()
        for table_name in (
            "palaces",
            "review_schedules",
            "session_progress",
        ):
            connection.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar()
        connection.execute(
            text(
                """
                SELECT id
                FROM review_schedules
                WHERE completed = 0 AND scheduled_date <= :today
                ORDER BY scheduled_date, COALESCE(scheduled_at, scheduled_date), id
                LIMIT 8
                """
            ),
            {"today": today},
        ).fetchall()
        from memory_anki.modules.reviews.application.review_execution_service import (
            detect_review_stage_progress_issues,
        )

        health = detect_review_stage_progress_issues(session)
        if health["needs_repair"]:
            logger.warning(
                "review stage progress self-check found %s issue(s); "
                "user can repair via POST /api/v1/review/repair-stage-progress",
                health["total_issues"],
            )
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
