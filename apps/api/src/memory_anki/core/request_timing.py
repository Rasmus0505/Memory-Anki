"""Request-local timings shared with synchronous FastAPI worker threads."""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from time import perf_counter


@dataclass
class RequestTiming:
    started_at: float
    worker_started_ms: float | None = None
    sql_count: int = 0
    sql_total_ms: float = 0.0
    sql_max_ms: float = 0.0
    connect_total_ms: float = 0.0

    def mark_worker_started(self) -> None:
        if self.worker_started_ms is None:
            self.worker_started_ms = (perf_counter() - self.started_at) * 1000

    def record_sql(self, elapsed_ms: float) -> None:
        self.sql_count += 1
        self.sql_total_ms += elapsed_ms
        self.sql_max_ms = max(self.sql_max_ms, elapsed_ms)

    def log_fields(self) -> dict[str, int | float | None]:
        return {
            "worker_started_ms": round(self.worker_started_ms, 2) if self.worker_started_ms is not None else None,
            "sql_count": self.sql_count,
            "sql_total_ms": round(self.sql_total_ms, 2),
            "sql_max_ms": round(self.sql_max_ms, 2),
            "connect_total_ms": round(self.connect_total_ms, 2),
        }


request_timing: ContextVar[RequestTiming | None] = ContextVar("request_timing", default=None)
