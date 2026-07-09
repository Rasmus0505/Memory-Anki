import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from memory_anki.app.startup_runtime import (
    STARTUP_MODE_SERVE,
    resolve_startup_mode,
)
from memory_anki.modules.settings.presentation import router as settings_router


class StartupModeTests(unittest.TestCase):
    def test_resolve_startup_mode_defaults_to_serve(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MEMORY_ANKI_STARTUP_MODE", None)
            self.assertEqual(resolve_startup_mode(), STARTUP_MODE_SERVE)

    def test_resolve_startup_mode_rejects_unknown_values(self):
        with patch.dict(os.environ, {"MEMORY_ANKI_STARTUP_MODE": "mystery"}, clear=False):
            self.assertEqual(resolve_startup_mode(), STARTUP_MODE_SERVE)

    def test_runtime_health_route_returns_startup_mode(self):
        app = FastAPI()
        app.include_router(settings_router.router, prefix="/api/v1")
        client = TestClient(app)

        with patch.dict(os.environ, {"MEMORY_ANKI_STARTUP_MODE": "healthcheck"}, clear=False), patch.object(
            settings_router,
            "build_runtime_health",
            return_value={
                "ok": True,
                "startup_mode": "healthcheck",
                "runtime_snapshot": None,
                "release_id": None,
                "started_at": "2026-06-01T00:00:00+00:00",
            },
        ) as build_runtime_health, patch.object(
            settings_router,
            "build_runtime_info",
        ) as build_runtime_info:
            response = client.get("/api/v1/runtime-health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "ok": True,
                "startup_mode": "healthcheck",
                "runtime_snapshot": None,
                "release_id": None,
                "started_at": "2026-06-01T00:00:00+00:00",
            },
        )
        build_runtime_health.assert_called_once()
        build_runtime_info.assert_not_called()

    def test_startup_warmup_runs_as_single_background_daemon(self):
        from memory_anki.app import startup_warmup

        startup_warmup.reset_startup_warmup_for_test()
        with patch.object(startup_warmup.threading, "Thread") as thread_cls:
            thread = thread_cls.return_value

            first = startup_warmup.start_startup_warmup()
            second = startup_warmup.start_startup_warmup()

        self.assertIs(first, thread)
        self.assertIsNone(second)
        thread_cls.assert_called_once()
        self.assertEqual(thread_cls.call_args.kwargs["name"], "memory-anki-startup-warmup")
        self.assertTrue(thread_cls.call_args.kwargs["daemon"])
        thread.start.assert_called_once()
        startup_warmup.reset_startup_warmup_for_test()

    def test_startup_warmup_swallows_and_logs_errors(self):
        from memory_anki.app import startup_warmup

        with patch.object(startup_warmup, "run_startup_warmup", side_effect=RuntimeError("boom")), patch.object(
            startup_warmup.logger,
            "exception",
        ) as log_exception:
            startup_warmup._run_startup_warmup_safely()

        log_exception.assert_called_once_with("startup warmup failed")

    def test_startup_warmup_logs_review_stage_progress_health_warning(self):
        from memory_anki.app import startup_warmup
        from memory_anki.modules.reviews.application import review_execution_service

        session = MagicMock()
        connection = MagicMock()
        result = MagicMock()
        result.scalar.return_value = 1
        result.fetchall.return_value = []
        connection.execute.return_value = result
        session.connection.return_value = connection

        with patch.object(startup_warmup, "get_session", return_value=session), patch.object(
            review_execution_service,
            "detect_review_stage_progress_issues",
            return_value={"needs_repair": True, "total_issues": 2},
        ) as detect, patch.object(startup_warmup.logger, "warning") as log_warning:
            startup_warmup.run_startup_warmup()

        detect.assert_called_once_with(session)
        log_warning.assert_called_once_with(
            "review stage progress self-check found %s issue(s); "
            "user can repair via POST /api/v1/review/repair-stage-progress",
            2,
        )
        session.close.assert_called_once()

    def test_lifespan_does_not_start_warmup_in_healthcheck_mode(self):
        from memory_anki.app import main as app_main

        async def run_lifespan():
            with patch.object(app_main, "resolve_startup_mode", return_value="healthcheck"), patch.object(
                app_main,
                "initialize_service_runtime",
                return_value=SimpleNamespace(runtime_info={"channel": "test"}),
            ), patch.object(app_main, "start_startup_warmup") as start_warmup:
                async with app_main.lifespan(FastAPI()):
                    pass
                start_warmup.assert_not_called()

        asyncio.run(run_lifespan())

    def test_study_startup_indexes_are_declared_on_review_schedule_table(self):
        from memory_anki.infrastructure.db._tables.palaces import ReviewSchedule

        self.assertIn(
            "ix_review_schedules_due_lookup",
            {index.name for index in ReviewSchedule.__table__.indexes},
        )
        self.assertIn(
            "ix_review_schedules_palace_progress",
            {index.name for index in ReviewSchedule.__table__.indexes},
        )


if __name__ == "__main__":
    unittest.main()
