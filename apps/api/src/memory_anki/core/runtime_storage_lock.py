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
_WAIT_SECONDS = 15.0


@contextmanager
def storage_write_lock(app_home: Path | None = None) -> Iterator[None]:
    """Serialize cooperating writers/snapshots; the OS releases on process exit."""
    home = Path(app_home) if app_home is not None else get_app_home()
    path = home / "日志缓存" / "runtime-storage.lock"
    key = str(path.resolve())
    with _registry_guard:
        lock = _locks.setdefault(key, threading.RLock())
    if not lock.acquire(timeout=_WAIT_SECONDS):
        raise TimeoutError("timed out acquiring runtime storage thread lock")
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
        deadline = time.monotonic() + _WAIT_SECONDS
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
                    raise TimeoutError("timed out acquiring runtime storage process lock") from exc
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
