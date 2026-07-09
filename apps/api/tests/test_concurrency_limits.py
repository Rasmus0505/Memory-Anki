import threading

import pytest
from fastapi import HTTPException

from memory_anki.core import concurrency_limits
from memory_anki.core.concurrency_limits import concurrency_slot


def test_second_acquire_rejected_while_first_held():
    entered = threading.Event()
    release = threading.Event()

    def hold():
        with concurrency_slot("heavy_upload"):
            entered.set()
            release.wait(timeout=5)

    worker = threading.Thread(target=hold)
    worker.start()
    try:
        assert entered.wait(timeout=5)
        with pytest.raises(HTTPException) as exc_info:
            with concurrency_slot("heavy_upload"):
                pass
        assert exc_info.value.status_code == 429
    finally:
        release.set()
        worker.join(timeout=5)


def test_slot_released_after_exception():
    with pytest.raises(RuntimeError):
        with concurrency_slot("heavy_upload"):
            raise RuntimeError("boom")
    with concurrency_slot("heavy_upload"):
        pass


def test_hourly_rate_limit(monkeypatch):
    monkeypatch.setattr(concurrency_limits, "AI_CALLS_PER_HOUR_LIMIT", 2)
    concurrency_limits._RATE_WINDOW.clear()
    try:
        with concurrency_slot("ai_generation", rate_limited=True):
            pass
        with concurrency_slot("ai_generation", rate_limited=True):
            pass
        with pytest.raises(HTTPException) as exc_info:
            with concurrency_slot("ai_generation", rate_limited=True):
                pass
        assert exc_info.value.status_code == 429
    finally:
        concurrency_limits._RATE_WINDOW.clear()
