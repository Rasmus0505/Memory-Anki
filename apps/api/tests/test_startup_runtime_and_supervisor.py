import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from memory_anki.app.startup_runtime import (
    STARTUP_MODE_SERVE,
    resolve_startup_mode,
)
from memory_anki.modules.settings.presentation import router as settings_router
from memory_anki.supervisor.runtime_supervisor import (
    ReleaseRecord,
    RuntimeSupervisor,
    SupervisorConfig,
)


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
            "build_runtime_info",
            return_value={"channel": "production", "runtime_generation": 1},
        ):
            response = client.get("/api/v1/runtime-health")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(response.json()["startup_mode"], "healthcheck")


class SupervisorRoutingTests(unittest.TestCase):
    def make_supervisor(self) -> RuntimeSupervisor:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        config = SupervisorConfig(
            repo_root=root,
            app_home=root / "home",
            runtime_root=root / "runtime",
            releases_root=root / "runtime" / "releases",
            logs_dir=root / "logs",
            state_path=root / "home" / "supervisor-state.json",
        )
        return RuntimeSupervisor(config)

    def test_document_request_promotes_ready_candidate(self):
        supervisor = self.make_supervisor()
        old_release = ReleaseRecord("old", "C:/old", "fp-old", 1, None, port=18021, ready=True)
        new_release = ReleaseRecord("new", "C:/new", "fp-new", 1, None, port=18022, ready=True)
        supervisor.releases = {"old": old_release, "new": new_release}
        supervisor.release_sessions = {"old": {}, "new": {}}
        supervisor.current_release_id = "old"
        supervisor.candidate_release_id = "new"

        handler = type(
            "Handler",
            (),
            {
                "command": "GET",
                "path": "/",
                "headers": {"Accept": "text/html"},
            },
        )()

        selected_release, set_cookie = supervisor._select_release_for_request(handler)

        self.assertEqual(selected_release.release_id, "new")
        self.assertEqual(supervisor.current_release_id, "new")
        self.assertIsNone(supervisor.candidate_release_id)
        self.assertIsNotNone(set_cookie)
        self.assertIn("memory_anki_release=new.", set_cookie)
        self.assertIsNotNone(supervisor.releases["old"].retired_at)

    def test_api_request_stays_on_cookie_release(self):
        supervisor = self.make_supervisor()
        old_release = ReleaseRecord("old", "C:/old", "fp-old", 1, None, port=18021, ready=True)
        new_release = ReleaseRecord("new", "C:/new", "fp-new", 1, None, port=18022, ready=True)
        supervisor.releases = {"old": old_release, "new": new_release}
        supervisor.release_sessions = {"old": {}, "new": {}}
        supervisor.current_release_id = "new"
        supervisor.candidate_release_id = None

        handler = type(
            "Handler",
            (),
            {
                "command": "POST",
                "path": "/api/v1/settings",
                "headers": {"Cookie": "memory_anki_release=old.session123"},
            },
        )()

        selected_release, set_cookie = supervisor._select_release_for_request(handler)

        self.assertEqual(selected_release.release_id, "old")
        self.assertIsNone(set_cookie)
        self.assertIn("session123", supervisor.release_sessions["old"])

    def test_document_request_keeps_current_release_when_candidate_is_not_routable(self):
        supervisor = self.make_supervisor()
        old_release = ReleaseRecord("old", "C:/old", "fp-old", 1, None, port=18021, ready=True)
        new_release = ReleaseRecord("new", "C:/new", "fp-new", 1, None, port=None, ready=True)
        supervisor.releases = {"old": old_release, "new": new_release}
        supervisor.release_sessions = {"old": {}, "new": {}}
        supervisor.current_release_id = "old"
        supervisor.candidate_release_id = "new"

        handler = type(
            "Handler",
            (),
            {
                "command": "GET",
                "path": "/",
                "headers": {"Accept": "text/html"},
            },
        )()

        selected_release, set_cookie = supervisor._select_release_for_request(handler)

        self.assertEqual(selected_release.release_id, "old")
        self.assertEqual(supervisor.current_release_id, "old")
        self.assertEqual(supervisor.candidate_release_id, "new")
        self.assertIsNotNone(set_cookie)
        self.assertIn("memory_anki_release=old.", set_cookie)

    def test_start_restores_candidate_release_before_serving(self):
        supervisor = self.make_supervisor()
        supervisor.releases = {
            "old": ReleaseRecord("old", "C:/old", "fp-old", 1, None, ready=True),
            "new": ReleaseRecord("new", "C:/new", "fp-new", 1, None, ready=True),
        }
        supervisor.release_sessions = {"old": {}, "new": {}}
        supervisor.current_release_id = "old"
        supervisor.candidate_release_id = "new"
        server = MagicMock()
        server.serve_forever.return_value = None

        with patch.object(supervisor, "load_state"), patch.object(
            supervisor,
            "_restore_saved_release",
            side_effect=[True, True],
        ) as restore_saved_release, patch.object(
            supervisor,
            "_compute_source_fingerprint",
            return_value="fp-old",
        ), patch(
            "memory_anki.supervisor.runtime_supervisor.threading.Thread"
        ) as thread_cls, patch(
            "memory_anki.supervisor.runtime_supervisor.ThreadingHTTPServer",
            return_value=server,
        ):
            thread_cls.return_value.start.return_value = None
            supervisor.start()

        self.assertEqual(restore_saved_release.call_args_list[0].args[0], "old")
        self.assertEqual(restore_saved_release.call_args_list[1].args[0], "new")


if __name__ == "__main__":
    unittest.main()
