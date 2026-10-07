"""Cooperating writers share one OS-released storage lock."""

from __future__ import annotations

import threading

import pytest

from memory_anki.core.runtime_storage_lock import (
    StorageBusyError,
    storage_write_lock,
)


def test_storage_write_lock_is_reentrant_and_exclusive(tmp_path):
    held = threading.Event()
    release = threading.Event()
    contender_entered = threading.Event()

    def holder() -> None:
        with storage_write_lock(tmp_path):
            with storage_write_lock(tmp_path):
                held.set()
                assert release.wait(timeout=2)

    def contender() -> None:
        assert held.wait(timeout=2)
        with storage_write_lock(tmp_path):
            contender_entered.set()

    first = threading.Thread(target=holder)
    second = threading.Thread(target=contender)
    first.start()
    second.start()
    assert held.wait(timeout=2)
    assert not contender_entered.wait(timeout=0.2)
    release.set()
    first.join(timeout=2)
    second.join(timeout=2)
    assert not first.is_alive()
    assert not second.is_alive()
    assert contender_entered.is_set()
    assert (tmp_path / "日志缓存" / "runtime-storage.lock").exists()


def test_lock_timeout_raises_retryable_storage_busy_error(tmp_path):
    """Contention must surface as a distinguishable, retryable busy signal.

    A background rolling backup can hold the lock for minutes. Callers need to
    tell that apart from a genuine fault so HTTP can answer 503 + Retry-After
    instead of the opaque 500 that used to reach the mindmap autosave UI.
    """
    held = threading.Event()
    release = threading.Event()

    def holder() -> None:
        with storage_write_lock(tmp_path):
            held.set()
            assert release.wait(timeout=5)

    holder_thread = threading.Thread(target=holder)
    holder_thread.start()
    assert held.wait(timeout=5)
    try:
        with pytest.raises(StorageBusyError) as excinfo:
            with storage_write_lock(tmp_path, wait_seconds=0.2):
                pytest.fail("lock must not be acquired while the holder is active")
    finally:
        release.set()
        holder_thread.join(timeout=5)

    error = excinfo.value
    # Subclassing TimeoutError keeps existing ``except TimeoutError`` callers working.
    assert isinstance(error, TimeoutError)
    assert 1 <= error.retry_after_seconds <= 30

    # The budget is honoured per call, so a background job can ask for longer.
    with storage_write_lock(tmp_path, wait_seconds=0.2):
        pass


def test_foreground_budget_is_shorter_than_background_default(tmp_path):
    """Foreground saves must not inherit a background job's long wait budget."""
    import inspect

    from memory_anki.core import runtime_storage_lock

    signature = inspect.signature(runtime_storage_lock.storage_write_lock)
    assert signature.parameters["wait_seconds"].default is None
    assert runtime_storage_lock._WAIT_SECONDS <= 30.0
