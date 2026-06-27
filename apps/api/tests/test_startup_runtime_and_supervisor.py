import os
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
