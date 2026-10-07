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
_locks: dict[str, threading.RLock] = {}
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
    """
    budget = _WAIT_SECONDS if wait_seconds is None else wait_seconds
    home = Path(app_home) if app_home is not None else get_app_home()
    path = home / "日志缓存" / "runtime-storage.lock"
    key = str(path.resolve())
    with _registry_guard:
        lock = _locks.setdefault(key, threading.RLock())
    if not lock.acquire(timeout=budget):
        raise StorageBusyError(
            "timed out acquiring runtime storage thread lock", wait_seconds=budget
        )
    held: set[str] = getattr(_state, "held", set())
    if key in held:
        try:
            yield
        finally:
            lock.release()
        return
    handle = None
    acquired = False
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
        held.add(key)
        _state.held = held
        yield
    finally:
        if acquired and handle is not None:
            held.discard(key)
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)  # type: ignore[attr-defined]
        if handle is not None:
            handle.close()
        lock.release()
