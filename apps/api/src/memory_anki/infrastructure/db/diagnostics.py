"""Bounded DB latency diagnostics; never log SQL text or bound parameters."""
from __future__ import annotations

import logging
from time import perf_counter
from typing import Any
from weakref import WeakSet

from sqlalchemy import event
from sqlalchemy.engine import Engine

from memory_anki.core.request_timing import request_timing

logger = logging.getLogger(__name__)
SLOW_DB_OPERATION_MS = 1000
_installed_engines: WeakSet[Engine] = WeakSet()


def start_connection_timer(connection_record: Any) -> None:
    connection_record.info["diagnostic_connect_started"] = perf_counter()


def finish_connection_timer(connection_record: Any) -> None:
    if connection_record is None:
        return
    started = connection_record.info.pop("diagnostic_connect_started", None)
    if started is None:
        return
    elapsed_ms = (perf_counter() - started) * 1000
    timing = request_timing.get()
    if timing is not None:
        timing.connect_total_ms += elapsed_ms
    if elapsed_ms >= SLOW_DB_OPERATION_MS:
        logger.warning("DB connection initialization in %.2fms [slow]", elapsed_ms)


def install_query_diagnostics(engine: Engine) -> None:
    if engine in _installed_engines:
        return
    _installed_engines.add(engine)

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        context._diagnostic_sql_started = perf_counter()

    def finish(context, *, failed: bool) -> None:
        started = getattr(context, "_diagnostic_sql_started", None)
        if started is None:
            return
        context._diagnostic_sql_started = None
        elapsed_ms = (perf_counter() - started) * 1000
        timing = request_timing.get()
        if timing is not None:
            timing.record_sql(elapsed_ms)
        if elapsed_ms >= SLOW_DB_OPERATION_MS:
            # Only the operation keyword is retained: no learner content or keys.
            words = str(context.statement or "").split(None, 1)
            operation = words[0].upper() if words else "UNKNOWN"
            if operation not in {"SELECT", "INSERT", "UPDATE", "DELETE", "PRAGMA"}:
                operation = "OTHER"
            logger.warning("DB %s in %.2fms failed=%s [slow]", operation, elapsed_ms, failed)

    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        finish(context, failed=False)

    def handle_error(exception_context):
        if exception_context.execution_context is not None:
            finish(exception_context.execution_context, failed=True)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    event.listen(engine, "after_cursor_execute", after_cursor_execute)
    event.listen(engine, "handle_error", handle_error)
