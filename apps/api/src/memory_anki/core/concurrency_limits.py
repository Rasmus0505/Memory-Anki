from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Generator
from contextlib import contextmanager

from fastapi import HTTPException

# Single-user product: constants are enough; no runtime config needed.
AI_GENERATION_MAX_CONCURRENCY = 2
HEAVY_UPLOAD_MAX_CONCURRENCY = 1
AI_CALLS_PER_HOUR_LIMIT = 60

_SEMAPHORES = {
    "ai_generation": threading.BoundedSemaphore(AI_GENERATION_MAX_CONCURRENCY),
    "heavy_upload": threading.BoundedSemaphore(HEAVY_UPLOAD_MAX_CONCURRENCY),
}

_RATE_LOCK = threading.Lock()
_RATE_WINDOW: deque[float] = deque()
_RATE_WINDOW_SECONDS = 3600.0


def _check_hourly_rate() -> None:
    now = time.monotonic()
    with _RATE_LOCK:
        while _RATE_WINDOW and now - _RATE_WINDOW[0] > _RATE_WINDOW_SECONDS:
            _RATE_WINDOW.popleft()
        if len(_RATE_WINDOW) >= AI_CALLS_PER_HOUR_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="AI 调用过于频繁（每小时上限已达），请稍后再试。",
            )
        _RATE_WINDOW.append(now)


@contextmanager
def concurrency_slot(kind: str, *, rate_limited: bool = False) -> Generator[None]:
    """Acquire a slot without queuing; reject immediately when saturated."""
    semaphore = _SEMAPHORES[kind]
    if not semaphore.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="已有同类 AI 任务在进行中，请等待其完成后重试。",
        )
    try:
        if rate_limited:
            _check_hourly_rate()
        yield
    finally:
        semaphore.release()
