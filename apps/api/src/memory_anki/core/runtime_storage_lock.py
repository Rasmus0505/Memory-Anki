"""OS-released, re-entrant lock shared by database and file-backed writes."""
from __future__ import annotations

import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from memory_anki.core.runtime_paths import get_app_home

_registry_guard = threading.Lock()
# Deliberately ``Lock``, not ``RLock``: this is a mutual-exclusion guard, not an
# ownership token. The holder is released wherever the work finishes, and that is
# legitimately a different thread from the one that took it -- FastAPI runs a
# sync endpoint and its generator-dependency teardown in separate threadpool
# calls, so a flush that raises defers its ROLLBACK to ``session.close()`` on
# another worker. ``RLock`` may only be released by its owning thread, so that
# teardown raised ``RuntimeError: cannot release un-acquired lock``, which
# (a) replaced the original exception in the log and (b) aborted the ``finally``
# before ``lock.release()``, wedging the process-wide lock forever. One such
# event produced 55 consecutive ``storage_busy`` 503s. Reentrancy is tracked
# separately by the per-thread ``_state.held`` set below, so nesting still works
# and a cross-thread release cannot over-release.
_locks: dict[str, threading.Lock] = {}
_state = threading.local()
# Foreground writes (autosave, review progress) must fail fast with a retryable
# busy signal rather than stall for minutes behind a background snapshot copy.
_WAIT_SECONDS = 15.0


class StorageBusyError(TimeoutError):
    """The shared runtime storage lock stayed busy past the wait budget.

    A ``TimeoutError`` subclass so existing callers that catch ``TimeoutError``
    keep working, but distinguishable so HTTP layers can answer 503 + Retry-After
    instead of reporting an opaque internal error.
    """

    def __init__(self, message: str, *, wait_seconds: float = _WAIT_SECONDS) -> None:
        super().__init__(message)
        self.wait_seconds = wait_seconds
        # Ambient detail for logs/debugging; never surfaced to the client.
        self.extra_detail: dict[str, object] = {}

    @property
    def retry_after_seconds(self) -> int:
        """Advertise a short retry window: the holder is expected to finish soon."""
        return max(1, min(30, int(self.wait_seconds)))


@contextmanager
def storage_write_lock(
    app_home: Path | None = None, *, wait_seconds: float | None = None
) -> Iterator[None]:
    """Serialize cooperating writers/snapshots; the OS releases on process exit.

    ``wait_seconds`` lets a background job that legitimately needs a long slot
    (for example an online database snapshot) opt into a longer budget without
    making foreground requests wait that long.

    Reentrancy is decided *before* touching the thread lock, because a plain
    ``Lock`` cannot be re-acquired by the thread already holding it. A nested call
    therefore only deepens this thread's own count; the outermost frame owns the
    lock and is the only one that releases it.

    Release is deliberately not thread-checked: the frame that finishes the work
    may be a different thread from the one that started it (see ``_locks``).
    """
    budget = _WAIT_SECONDS if wait_seconds is None else wait_seconds
    home = Path(app_home) if app_home is not None else get_app_home()
    path = home / "日志缓存" / "runtime-storage.lock"
    key = str(path.resolve())
    held: dict[str, int] = getattr(_state, "held", None) or {}
    _state.held = held

    if held.get(key, 0) > 0:
        # Nested acquisition on this thread: the outer frame holds the lock.
        held[key] += 1
        try:
            yield
        finally:
            remaining = held.get(key, 1) - 1
            if remaining > 0:
                held[key] = remaining
            else:
                held.pop(key, None)
        return

    with _registry_guard:
        lock = _locks.setdefault(key, threading.Lock())
    if not lock.acquire(timeout=budget):
        raise StorageBusyError(
            "timed out acquiring runtime storage thread lock", wait_seconds=budget
        )
    handle = None
    acquired = False
    held[key] = 1
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("a+b")
        if path.stat().st_size == 0:
            handle.write(b"\0")
            handle.flush()
        deadline = time.monotonic() + budget
        while True:
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)  # type: ignore[attr-defined]
                acquired = True
                break
            except OSError as exc:
                if time.monotonic() >= deadline:
                    raise StorageBusyError(
                        "timed out acquiring runtime storage process lock",
                        wait_seconds=budget,
                    ) from exc
                time.sleep(0.025)
        yield
    finally:
        # This block must not raise: an exception here would replace the error
        # that caused the unwind (which is how the original fault stayed hidden)
        # and would skip ``lock.release()``, wedging every later writer.
        if acquired and handle is not None:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)  # type: ignore[attr-defined]
        if handle is not None:
            handle.close()
        held.pop(key, None)
        try:
            lock.release()
        except RuntimeError:  # pragma: no cover - defensive; a Lock cannot do this
            # A ``threading.Lock`` releases from any thread, so this is
            # unreachable unless the lock object itself was replaced. Swallow it
            # rather than mask the in-flight exception.
            pass
