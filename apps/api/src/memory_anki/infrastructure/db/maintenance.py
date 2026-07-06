from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.engine import Engine

from memory_anki.core.config import is_cloud_deploy
from memory_anki.infrastructure.db.models import engine as default_engine

logger = logging.getLogger(__name__)


class DatabaseMaintenanceError(RuntimeError):
    pass


def checkpoint_sqlite_wal(
    engine: Engine = default_engine,
    *,
    require_complete: bool = False,
) -> bool:
    if is_cloud_deploy() or engine.dialect.name != "sqlite":
        return False
    try:
        with engine.begin() as connection:
            result = connection.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
            row = result.first()
    except Exception:
        if require_complete:
            raise DatabaseMaintenanceError("SQLite WAL checkpoint failed.") from None
        logger.warning("SQLite WAL checkpoint failed", exc_info=True)
        return False
    if not _checkpoint_completed(row):
        message = f"SQLite WAL checkpoint did not complete: {row!r}"
        if require_complete:
            raise DatabaseMaintenanceError(message)
        logger.warning(message)
        return False
    return True


def analyze_database(engine: Engine = default_engine) -> bool:
    if is_cloud_deploy() or engine.dialect.name != "sqlite":
        return False
    try:
        with engine.begin() as connection:
            connection.execute(text("ANALYZE"))
    except Exception:
        logger.warning("SQLite ANALYZE failed", exc_info=True)
        return False
    return True


def _checkpoint_completed(row) -> bool:
    if row is None or len(row) < 3:
        return False
    busy, log_frames, checkpointed_frames = row[0], row[1], row[2]
    try:
        return int(busy or 0) == 0 and int(checkpointed_frames or 0) >= int(log_frames or 0)
    except (TypeError, ValueError):
        return False
