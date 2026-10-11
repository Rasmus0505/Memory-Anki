from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables._base import get_session
from memory_anki.infrastructure.db._tables.misc import Config

logger = logging.getLogger(__name__)

MUTATION_RESPONSE_CONFIG_PREFIX = "api_mutation."
# Long enough for an offline-queued write to be replayed once the device is back.
MUTATION_RESPONSE_TTL_DAYS = 7
# Small batches keep each delete transaction short so study writes never queue behind it.
PURGE_BATCH_SIZE = 500
PURGE_INTERVAL_SECONDS = 6 * 60 * 60

_PURGE_LOOP_THREAD: threading.Thread | None = None
_PURGE_LOOP_STOP = threading.Event()


def _like_prefix_pattern(prefix: str) -> str:
    return prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def purge_expired_mutation_responses(
    session: Session,
    *,
    ttl_days: int = MUTATION_RESPONSE_TTL_DAYS,
    now: datetime | None = None,
    batch_size: int | None = None,
) -> int:
    cutoff = (now or utc_now_naive()) - timedelta(days=ttl_days)
    expired = (
        Config.key.like(_like_prefix_pattern(MUTATION_RESPONSE_CONFIG_PREFIX), escape="\\"),
        or_(Config.updated_at.is_(None), Config.updated_at < cutoff),
    )
    if batch_size is None:
        deleted = session.query(Config).filter(*expired).delete(synchronize_session=False)
        session.commit()
        return int(deleted)
    total = 0
    while True:
        ids = [row[0] for row in session.query(Config.id).filter(*expired).limit(batch_size).all()]
        if not ids:
            return total
        session.query(Config).filter(Config.id.in_(ids)).delete(synchronize_session=False)
        session.commit()
        total += len(ids)


def _purge_once() -> int:
    session = get_session()
    try:
        return purge_expired_mutation_responses(session, batch_size=PURGE_BATCH_SIZE)
    finally:
        session.close()


def start_mutation_response_purge_loop() -> None:
    """Serve-mode purge so expired receipts never pile up in ``config``."""
    global _PURGE_LOOP_THREAD
    if _PURGE_LOOP_THREAD and _PURGE_LOOP_THREAD.is_alive():
        return
    _PURGE_LOOP_STOP.clear()

    def run() -> None:
        # The first pass waits a little so it never competes with startup warmups.
        wait = 30.0
        while not _PURGE_LOOP_STOP.wait(timeout=wait):
            wait = PURGE_INTERVAL_SECONDS
            try:
                removed = _purge_once()
                if removed:
                    logger.info("purged %s expired mutation receipts", removed)
            except Exception:
                logger.exception("mutation receipt purge failed")

    _PURGE_LOOP_THREAD = threading.Thread(target=run, name="memory-anki-receipt-purge", daemon=True)
    _PURGE_LOOP_THREAD.start()


def stop_mutation_response_purge_loop() -> None:
    _PURGE_LOOP_STOP.set()
