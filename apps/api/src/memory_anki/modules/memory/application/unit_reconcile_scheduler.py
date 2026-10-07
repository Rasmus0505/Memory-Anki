"""Background reconcile queue for lagging review-unit topology.

Why this exists
---------------
``list_due_units`` used to repair a stale palace *inside the read request*. That
repair is a write, so SQLAlchemy's ``before_flush`` hook took the single global
runtime storage lock (shared with backups and every other writer) for the whole
rebuild. A "show me my queue" GET could therefore hold the one lock that every
rating, autosave and session start needs, and requests that waited longer than
``_WAIT_SECONDS`` failed with 503 while the client retried -- each retry adding
more contention. That feedback loop is what made rating appear frozen.

The read path now *defers*: it records the palace here and returns the projection
it already has. The reconciler drains this queue off the request path, so the
lock is taken in short bursts by a background worker instead of being held
across a user-visible request.

Freshness contract
------------------
The owner chose "content must be current over 'never wait'", so deferral is
deliberately short-lived: a queued palace is reconciled on the next drain tick
(seconds), and the drain also runs at the end of the round/session write paths
that can make a palace stale in the first place. A deferred palace simply serves
a slightly short queue for that instant instead of stalling the API.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

_guard = threading.Lock()
_pending: set[int] = set()
# A palace that keeps failing must not be retried on every tick forever; the
# count is only for diagnostics and to avoid a tight failure loop.
_attempts: dict[int, int] = {}
_MAX_ATTEMPTS = 5

_inflight = threading.Lock()


def schedule_reconcile(palace_ids: list[int] | tuple[int, ...] | set[int]) -> int:
    """Record palaces whose stored unit hashes lag the live editor topology.

    Cheap, non-blocking and callable from a request that must not write. Returns
    how many newly queued palaces were added.
    """
    added = 0
    with _guard:
        for palace_id in palace_ids:
            try:
                pid = int(palace_id)
            except (TypeError, ValueError):
                continue
            if pid in _pending:
                continue
            if _attempts.get(pid, 0) >= _MAX_ATTEMPTS:
                continue
            _pending.add(pid)
            added += 1
    if added:
        logger.info("queued %d palace(s) for background unit reconcile", added)
    return added


def pending_palace_ids() -> list[int]:
    with _guard:
        return sorted(_pending)


def has_pending() -> bool:
    with _guard:
        return bool(_pending)


def clear_pending() -> None:
    """Test/support hook: forget queued work and failure counters."""
    with _guard:
        _pending.clear()
        _attempts.clear()


def drain_once(
    *,
    limit: int = 4,
    session_factory: Callable[[], Any] | None = None,
) -> dict[str, int]:
    """Reconcile at most ``limit`` queued palaces on this thread.

    Opens its own short-lived session so the write lock is only held for the
    duration of one palace rebuild, and a failure on one palace cannot poison
    the others. Safe to call from a request handler (after it has finished its
    own work) or from a background tick.

    ``session_factory`` lets a caller (or a test) supply the engine to use.
    Without it the process-wide engine is used, which is what production wants
    and what keeps a background tick from borrowing a request's connection.
    """
    if not _inflight.acquire(blocking=False):
        # Another drain is already working; let it finish rather than pile on and
        # re-create the contention this module exists to remove.
        return {"reconciled": 0, "failed": 0, "skipped": 0}
    try:
        with _guard:
            batch = sorted(_pending)[: max(0, limit)]
            for pid in batch:
                _pending.discard(pid)

        if not batch:
            return {"reconciled": 0, "failed": 0, "skipped": 0}

        reconciled = 0
        failed = 0
        from memory_anki.modules.memory.application.unit_reconcile import (
            reconcile_palace_units,
        )

        if session_factory is None:
            from memory_anki.infrastructure.db._tables._base import get_session

            session_factory = get_session

        for pid in batch:
            session = session_factory()
            try:
                reconcile_palace_units(session, pid)
                session.commit()
                reconciled += 1
                with _guard:
                    _attempts.pop(pid, None)
            except Exception:
                # Requeue with a bounded attempt budget. A palace that cannot be
                # reconciled must not block the queue for every other palace.
                session.rollback()
                failed += 1
                with _guard:
                    attempts = _attempts.get(pid, 0) + 1
                    _attempts[pid] = attempts
                    if attempts < _MAX_ATTEMPTS:
                        _pending.add(pid)
                logger.warning(
                    "background reconcile failed for palace %s (attempt %d/%d)",
                    pid,
                    _attempts.get(pid, attempts),
                    _MAX_ATTEMPTS,
                    exc_info=True,
                )
            finally:
                session.close()
        return {"reconciled": reconciled, "failed": failed, "skipped": 0}
    finally:
        _inflight.release()


def start_reconcile_worker(*, interval_seconds: float = 2.0) -> threading.Thread:
    """Start the daemon tick that keeps deferred palaces converging.

    Daemon so process exit is never blocked; the loop only does work when the
    queue is non-empty, so an idle app costs nothing.
    """
    stop = threading.Event()

    def _loop() -> None:
        while not stop.wait(interval_seconds):
            try:
                if has_pending():
                    drain_once()
            except Exception:  # pragma: no cover - defensive tick guard
                logger.warning("background reconcile tick failed", exc_info=True)

    thread = threading.Thread(target=_loop, name="unit-reconcile", daemon=True)
    thread.start()
    logger.info("background unit reconcile worker started")
    return thread


__all__ = [
    "clear_pending",
    "drain_once",
    "has_pending",
    "pending_palace_ids",
    "schedule_reconcile",
    "start_reconcile_worker",
]
