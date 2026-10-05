from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from unittest.mock import patch

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from memory_anki.core.request_logging import RequestLoggingMiddleware
from memory_anki.core.request_timing import RequestTiming, request_timing
from memory_anki.infrastructure.db import deps, diagnostics


def test_worker_context_updates_parent_request_timing():
    timing = RequestTiming(10.0)
    token = request_timing.set(timing)
    try:
        context = copy_context()
        with patch("memory_anki.core.request_timing.perf_counter", return_value=12.0):
            with ThreadPoolExecutor(max_workers=1) as executor:
                executor.submit(context.run, timing.mark_worker_started).result()
        assert timing.worker_started_ms == 2000.0
    finally:
        request_timing.reset(token)


def test_sql_timings_include_failures_without_logging_content(caplog):
    engine = create_engine("sqlite://")
    diagnostics.install_query_diagnostics(engine)
    timing = RequestTiming(0.0)
    token = request_timing.set(timing)
    try:
        with engine.connect() as connection:
            with patch.object(diagnostics, "perf_counter", side_effect=[0.0, 1.5, 2.0, 4.0]):
                with caplog.at_level(logging.WARNING, logger=diagnostics.__name__):
                    assert connection.execute(text("SELECT :secret"), {"secret": "private"}).scalar() == "private"
                    with pytest.raises(OperationalError):
                        connection.execute(text("SELECT private_missing FROM private_table"))
        assert timing.sql_count == 2
        assert timing.sql_total_ms == 3500.0
        assert timing.sql_max_ms == 2000.0
        messages = [record.getMessage() for record in caplog.records]
        assert len(messages) == 2
        assert "failed=False" in messages[0]
        assert "failed=True" in messages[1]
        assert all("private" not in message for message in messages)
    finally:
        request_timing.reset(token)
        engine.dispose()


def test_connection_initialization_is_attributed(caplog):
    class Record:
        info: dict = {}

    record = Record()
    timing = RequestTiming(0.0)
    token = request_timing.set(timing)
    try:
        with patch.object(diagnostics, "perf_counter", side_effect=[0.0, 2.5]):
            with caplog.at_level(logging.WARNING, logger=diagnostics.__name__):
                diagnostics.start_connection_timer(record)
                diagnostics.finish_connection_timer(record)
        assert timing.connect_total_ms == 2500.0
        assert not record.info
        assert "connection initialization" in caplog.records[0].getMessage()
    finally:
        request_timing.reset(token)


def test_request_summary_contains_db_metrics_from_sync_worker(caplog, monkeypatch):
    class FakeSession:
        def close(self):
            pass

    monkeypatch.setattr(deps, "get_session", FakeSession)
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/overview")
    def overview(session=Depends(deps.session_dep)):
        timing = request_timing.get()
        assert timing is not None
        timing.record_sql(1234.0)
        return {"ok": True}

    monkeypatch.setattr("memory_anki.core.request_logging.SLOW_REQUEST_THRESHOLD_MS", 0)
    with caplog.at_level(logging.WARNING, logger="memory_anki.request"):
        with TestClient(app) as client:
            response = client.get("/overview", headers={"X-Request-ID": "diagnostic-request"})
    assert response.headers["X-Request-ID"] == "diagnostic-request"
    record = caplog.records[-1]
    assert record.worker_started_ms is not None
    assert record.sql_count == 1
    assert record.sql_total_ms == 1234.0
    assert "worker_started_ms=" in record.getMessage()
    assert "sql_max_ms=1234.0" in record.getMessage()
    assert request_timing.get() is None
