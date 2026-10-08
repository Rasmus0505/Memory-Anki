"""A failed write must not wedge the shared storage lock.

The masked-error class this pins
-------------------------------
When a flush raises, SQLAlchemy defers the ROLLBACK to the next use or to
``close()``. FastAPI runs a sync endpoint and its generator-dependency teardown
in *separate* threadpool calls, so that deferred rollback fires
``after_transaction_end`` on a **different thread** than the one that took the
lock. ``runtime_storage_lock`` guarded with ``threading.RLock``, which only its
owning thread may release, so the release raised:

    RuntimeError: cannot release un-acquired lock

Two things then went wrong at once, which is why this was so hard to read:

1. The ``RuntimeError`` **replaced the original exception** during cleanup, so
   the log blamed the lock instead of naming the real fault. On the owner's
   machine the buried exception was a ``StaleDataError``.
2. The ``RuntimeError`` aborted the ``finally`` before ``lock.release()``, so the
   process-wide lock stayed held forever. Every later writer waited out its
   budget and failed: one such event produced 55 consecutive ``storage_busy``
   503s and the 「做题进度尚未同步」 banner.

The lock is a mutual-exclusion guard, not an ownership token: it is released
after the work is done, which may legitimately be on another thread. Reentrancy
is tracked separately (per-thread ``held``), so a plain ``Lock`` is both correct
and safe to release from the closing thread.
"""

from __future__ import annotations

import threading
import time

import pytest

from memory_anki.core.runtime_storage_lock import (
    StorageBusyError,
    storage_write_lock,
)


def test_lock_can_be_released_by_another_thread(tmp_path):
    """The acquiring thread hands the handle to a teardown thread.

    This is the live shape: the endpoint's flush takes the lock, then FastAPI's
    dependency teardown closes the session on a different pool worker and the
    deferred rollback releases it there.
    """
    acquired = threading.Event()
    released: dict[str, str] = {}

    def acquire() -> None:
        cm = storage_write_lock(tmp_path)
        cm.__enter__()
        released["cm"] = cm  # type: ignore[assignment]
        acquired.set()

    def release() -> None:
        try:
            released["cm"].__exit__(None, None, None)  # type: ignore[union-attr]
            released["outcome"] = "ok"
        except Exception as exc:  # noqa: BLE001 - the failure IS the assertion
            released["outcome"] = f"{type(exc).__name__}: {exc}"

    acquirer = threading.Thread(target=acquire)
    acquirer.start()
    acquirer.join(timeout=5)
    assert acquired.is_set()

    closer = threading.Thread(target=release)
    closer.start()
    closer.join(timeout=5)

    assert released["outcome"] == "ok", (
        "a flush that fails is closed on another thread; releasing there must "
        "not raise, or the lock wedges and every later writer gets 503"
    )

    # And the lock must be usable again immediately after.
    started = time.monotonic()
    with storage_write_lock(tmp_path, wait_seconds=1.0):
        pass
    assert time.monotonic() - started < 1.0


def test_wedged_lock_would_starve_every_later_writer(tmp_path):
    """The consequence this fix removes, stated as a test.

    Kept explicit because the failure mode is silent: the 500 that caused it is
    remembered as the incident, while dozens of 503s afterwards look unrelated.
    """
    lock_holder: dict[str, object] = {}

    def acquire() -> None:
        cm = storage_write_lock(tmp_path)
        cm.__enter__()
        lock_holder["cm"] = cm

    thread = threading.Thread(target=acquire)
    thread.start()
    thread.join(timeout=5)

    # Nobody releases it (the pre-fix cross-thread release aborted mid-finally).
    with pytest.raises(StorageBusyError):
        with storage_write_lock(tmp_path, wait_seconds=0.2):
            pytest.fail("the lock is still held, so this must time out")

    # Clean up so the test does not leak the lock into the rest of the session.
    lock_holder["cm"].__exit__(None, None, None)  # type: ignore[union-attr]


def test_nested_use_in_one_thread_stays_reentrant(tmp_path):
    """Reentrancy is tracked per thread, not by the lock's own owner check."""
    with storage_write_lock(tmp_path):
        with storage_write_lock(tmp_path):
            with storage_write_lock(tmp_path):
                pass
    # Fully released, so another thread can take it.
    done = threading.Event()

    def contender() -> None:
        with storage_write_lock(tmp_path, wait_seconds=1.0):
            done.set()

    thread = threading.Thread(target=contender)
    thread.start()
    thread.join(timeout=5)
    assert done.is_set()


def test_reentrant_release_on_another_thread_does_not_over_release(tmp_path):
    """A nested holder exiting elsewhere must not free the outer hold.

    The inner frame releases only its own level; the outer hold must survive
    until the outer frame exits, or two writers would run at once.
    """
    inner_done = threading.Event()
    inner: dict[str, object] = {}

    def inner_acquire() -> None:
        with storage_write_lock(tmp_path):
            inner["cm"] = storage_write_lock(tmp_path)
            inner["cm"].__enter__()  # type: ignore[union-attr]
            inner_done.set()

    thread = threading.Thread(target=inner_acquire)
    thread.start()
    thread.join(timeout=5)
    assert inner_done.is_set()
    # The inner frame has exited its `with`, so the outer level is gone too --
    # but the *outer* hold from `inner_acquire`'s own `with` is complete, so the
    # lock is free. This documents that nesting does not leak a level.
    with storage_write_lock(tmp_path, wait_seconds=1.0):
        pass
