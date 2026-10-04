from __future__ import annotations

import logging
import unittest
from logging.config import fileConfig
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from memory_anki.app import startup_runtime
from memory_anki.core import request_logging
from memory_anki.core.logging import LOG_FORMAT, configure_logging
from memory_anki.core.request_logging import RequestLoggingMiddleware

API_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = API_ROOT / "alembic.ini"


class _LoggingSnapshot:
    """Snapshot and restore process-wide logging state around a test."""

    def __enter__(self) -> _LoggingSnapshot:
        root = logging.getLogger()
        self._root_level = root.level
        self._root_handlers = list(root.handlers)
        self._disabled = {
            name: logger.disabled
            for name, logger in logging.Logger.manager.loggerDict.items()
            if isinstance(logger, logging.Logger)
        }
        return self

    def __exit__(self, *_exc) -> bool:
        root = logging.getLogger()
        root.handlers[:] = self._root_handlers
        root.setLevel(self._root_level)
        for name, logger in logging.Logger.manager.loggerDict.items():
            if isinstance(logger, logging.Logger) and name in self._disabled:
                logger.disabled = self._disabled[name]
        return False


class _CaptureHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


class ConfigureLoggingTests(unittest.TestCase):
    def test_configure_logging_recovers_from_alembic_fileconfig(self):
        # Mimic a module-level logger created at import time.
        request_logger = logging.getLogger("memory_anki.request")

        with _LoggingSnapshot():
            # Alembic's fileConfig defaults: WARN root + disable_existing_loggers.
            fileConfig(str(ALEMBIC_INI), disable_existing_loggers=True)
            self.assertEqual(logging.getLogger().level, logging.WARNING)
            self.assertTrue(request_logger.disabled)

            configure_logging()

            root = logging.getLogger()
            self.assertEqual(root.level, logging.INFO)
            self.assertFalse(request_logger.disabled)
            self.assertEqual(request_logger.getEffectiveLevel(), logging.INFO)
            self.assertTrue(
                any(
                    getattr(handler.formatter, "_style", None) is not None
                    and handler.formatter._style._fmt == LOG_FORMAT
                    for handler in root.handlers
                )
            )

            # The regression: an INFO request log must actually reach a handler.
            capture = _CaptureHandler()
            root.addHandler(capture)
            try:
                request_logger.info("GET /api/v1/review/queue -> 200 in 12ms")
            finally:
                root.removeHandler(capture)

            self.assertEqual(len(capture.records), 1)
            self.assertEqual(capture.records[0].request_id, "-")


class StartupLoggingOrderTests(unittest.TestCase):
    def test_service_runtime_reapplies_logging_after_migrations(self):
        calls: list[str] = []

        def recorder(name: str):
            def record(*_args, **_kwargs):
                calls.append(name)
                return {}

            return record

        with patch.object(
            startup_runtime, "configure_logging", side_effect=recorder("configure_logging")
        ), patch.object(
            startup_runtime, "init_db", side_effect=recorder("init_db")
        ), patch.object(
            startup_runtime,
            "ensure_legacy_repo_data_migrated",
            side_effect=recorder("migrate_legacy_data"),
        ), patch.object(
            startup_runtime, "build_runtime_info", side_effect=recorder("build_runtime_info")
        ):
            startup_runtime.initialize_service_runtime(
                FastAPI(), mode=startup_runtime.STARTUP_MODE_PREPARE
            )

        self.assertIn("init_db", calls)
        last_configure = max(
            index for index, name in enumerate(calls) if name == "configure_logging"
        )
        self.assertGreater(last_configure, calls.index("init_db"))


class _FakeTime:
    def __init__(self, values: list[float]) -> None:
        self._values = list(values)

    def perf_counter(self) -> float:
        return self._values.pop(0)


class RequestLoggingMiddlewareTests(unittest.TestCase):
    def _client(self) -> TestClient:
        app = FastAPI()
        app.add_middleware(RequestLoggingMiddleware)

        @app.get("/slow")
        def slow():
            return {"ok": True}

        @app.get("/session/live/stream")
        def stream():
            return {"ok": True}

        return TestClient(app)

    def test_slow_requests_are_escalated_to_warning_with_duration(self):
        client = self._client()
        with patch.object(request_logging, "time", _FakeTime([0.0, 5.0])):
            with self.assertLogs("memory_anki.request", level="WARNING") as captured:
                client.get("/slow")

        self.assertEqual(len(captured.records), 1)
        self.assertIn("GET /slow -> 200 in 5000.0ms", captured.records[0].getMessage())
        self.assertIn("[slow]", captured.records[0].getMessage())
        self.assertEqual(captured.records[0].duration_ms, 5000.0)

    def test_long_lived_streams_are_not_flagged_as_slow(self):
        client = self._client()
        with patch.object(request_logging, "time", _FakeTime([0.0, 30.0])):
            with self.assertLogs("memory_anki.request", level="INFO") as captured:
                client.get("/session/live/stream")

        self.assertEqual(len(captured.records), 1)
        self.assertEqual(captured.records[0].levelno, logging.INFO)
        self.assertIn("GET /session/live/stream -> 200", captured.records[0].getMessage())


if __name__ == "__main__":
    unittest.main()
