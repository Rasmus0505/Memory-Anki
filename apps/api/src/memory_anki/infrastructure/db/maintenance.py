from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.engine import Engine

from memory_anki.infrastructure.db.models import engine as default_engine

logger = logging.getLogger(__name__)


def checkpoint_sqlite_wal(engine: Engine = default_engine) -> bool:
    if engine.dialect.name != "sqlite":
        return False
    try:
        with engine.begin() as connection:
            connection.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
    except Exception:
        logger.warning("SQLite WAL checkpoint failed", exc_info=True)
        return False
    return True


def analyze_database(engine: Engine = default_engine) -> bool:
    if engine.dialect.name != "sqlite":
        return False
    try:
        with engine.begin() as connection:
            connection.execute(text("ANALYZE"))
    except Exception:
        logger.warning("SQLite ANALYZE failed", exc_info=True)
        return False
    return True
