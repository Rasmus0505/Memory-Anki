"""Cooperating writers share one OS-released storage lock."""

from __future__ import annotations

import threading

from memory_anki.core.runtime_storage_lock import storage_write_lock


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
