import io
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
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
from memory_anki.supervisor import runtime_supervisor_support
from memory_anki.supervisor.runtime_supervisor_support import (
    RUN_MODE_SUPERVISOR,
    RUN_MODE_WORKSPACE_LATEST,
    build_hidden_process_kwargs,
    ensure_background_supervisor,
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
            "build_runtime_health",
            return_value={
                "ok": True,
                "startup_mode": "healthcheck",
                "runtime_snapshot": "C:/runtime/releases/rel-123",
                "release_id": "rel-123",
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
                "runtime_snapshot": "C:/runtime/releases/rel-123",
                "release_id": "rel-123",
                "started_at": "2026-06-01T00:00:00+00:00",
            },
        )
        build_runtime_health.assert_called_once()
        build_runtime_info.assert_not_called()


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
            "memory_anki.supervisor.runtime_supervisor_lifecycle.threading.Thread"
        ) as thread_cls, patch(
            "memory_anki.supervisor.runtime_supervisor_lifecycle.ThreadingHTTPServer",
            return_value=server,
        ):
            thread_cls.return_value.start.return_value = None
            supervisor.start()

        self.assertEqual(restore_saved_release.call_args_list[0].args[0], "old")
        self.assertEqual(restore_saved_release.call_args_list[1].args[0], "new")

    def test_supervisor_status_reports_candidate_and_build_diagnostics(self):
        supervisor = self.make_supervisor()
        supervisor.releases = {
            "old": ReleaseRecord("old", "C:/old", "fp-old", 1, None, port=18021, ready=True),
            "new": ReleaseRecord("new", "C:/new", "fp-new", 1, None, port=18022, ready=False),
            "retired": ReleaseRecord("retired", "C:/retired", "fp-retired", 1, None, port=18023, ready=True, retired_at=time.time()),
        }
        supervisor.current_release_id = "old"
        supervisor.candidate_release_id = "new"
        supervisor.last_successful_release_id = "old"
        supervisor.last_publish_error = "boom"
        supervisor.building = True
        supervisor.build_started_at = time.time() - 5

        status = supervisor._supervisor_status()

        self.assertEqual(status["current_release_id"], "old")
        self.assertEqual(status["candidate_release_id"], "new")
        self.assertEqual(status["last_successful_release_id"], "old")
        self.assertEqual(status["last_publish_error"], "boom")
        self.assertIsInstance(status["build_started_at"], str)
        self.assertGreaterEqual(status["build_stuck_seconds"], 5)
        release_states = {item["release_id"]: item["state"] for item in status["releases"]}
        self.assertEqual(release_states["old"], "current")
        self.assertEqual(release_states["new"], "candidate_pending")
        self.assertEqual(release_states["retired"], "retired")

    def test_proxy_request_recovers_release_after_connection_refused(self):
        supervisor = self.make_supervisor()
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        release_path = Path(temp_dir.name) / "release"
        release_path.mkdir(parents=True, exist_ok=True)
        release = ReleaseRecord("current", str(release_path), "fp-current", 1, None, port=18021, ready=True)
        supervisor.releases = {"current": release}
        supervisor.release_sessions = {"current": {}}
        supervisor.current_release_id = "current"

        handler = MagicMock()
        handler.command = "GET"
        handler.path = "/"
        handler.headers = {"Accept": "text/html"}
        handler.rfile = io.BytesIO()
        handler.wfile = io.BytesIO()

        first_connection = MagicMock()
        first_connection.request.side_effect = ConnectionRefusedError(10061, "actively refused")
        second_connection = MagicMock()
        response = MagicMock()
        response.status = 200
        response.reason = "OK"
        response.getheaders.return_value = [("Content-Type", "text/html; charset=utf-8")]
        response.read.side_effect = [b"ok", b""]
        second_connection.getresponse.return_value = response

        def restore_saved_release(release_id: str | None) -> bool:
            self.assertEqual(release_id, "current")
            supervisor.releases["current"].port = 18022
            return True

        with patch(
            "memory_anki.supervisor.runtime_supervisor_proxy.http.client.HTTPConnection",
            side_effect=[first_connection, second_connection],
        ), patch.object(
            supervisor,
            "_restore_saved_release",
            side_effect=restore_saved_release,
        ) as restore_saved_release_mock, patch.object(
            supervisor,
            "_stop_release_process",
        ) as stop_release_process:
            supervisor._proxy_request(handler)

        stop_release_process.assert_called_once_with("current")
        restore_saved_release_mock.assert_called_once_with("current")
        handler.send_response.assert_called_with(200, "OK")
        self.assertEqual(handler.wfile.getvalue(), b"ok")


class SupervisorProcessLaunchTests(unittest.TestCase):
    def test_build_hidden_process_kwargs_hides_windows_window(self):
        startupinfo = MagicMock()
        startupinfo.dwFlags = 0
        startupinfo.wShowWindow = 1

        with patch.object(
            runtime_supervisor_support,
            "os",
            SimpleNamespace(name="nt"),
            create=True,
        ), patch.object(
            subprocess,
            "STARTUPINFO",
            return_value=startupinfo,
            create=True,
        ), patch.object(
            subprocess,
            "STARTF_USESHOWWINDOW",
            8,
            create=True,
        ), patch.object(
            subprocess,
            "SW_HIDE",
            0,
            create=True,
        ), patch.object(
            subprocess,
            "DETACHED_PROCESS",
            0x8,
            create=True,
        ), patch.object(
            subprocess,
            "CREATE_NEW_PROCESS_GROUP",
            0x200,
            create=True,
        ), patch.object(
            subprocess,
            "CREATE_NO_WINDOW",
            0x08000000,
            create=True,
        ):
            kwargs = build_hidden_process_kwargs()

        self.assertEqual(kwargs["startupinfo"], startupinfo)
        self.assertTrue(startupinfo.dwFlags & 8)
        self.assertEqual(startupinfo.wShowWindow, 0)
        self.assertEqual(kwargs["creationflags"], 0x08000208)

    def test_run_logged_command_passes_hidden_process_kwargs(self):
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
        config.logs_dir.mkdir(parents=True, exist_ok=True)
        supervisor = RuntimeSupervisor(config)
        hidden_kwargs = {"creationflags": 123, "startupinfo": object()}
        completed = subprocess.CompletedProcess(args=["cmd"], returncode=0)

        with patch(
            "memory_anki.supervisor.runtime_supervisor.build_hidden_process_kwargs",
            return_value=hidden_kwargs,
        ), patch("memory_anki.supervisor.runtime_supervisor.subprocess.run", return_value=completed) as run_mock:
            supervisor._run_logged_command(
                command=["npm.cmd", "run", "build"],
                cwd=root,
                env={"A": "B"},
                log_name="build.log",
            )

        self.assertEqual(run_mock.call_args.kwargs["creationflags"], 123)
        self.assertIs(run_mock.call_args.kwargs["startupinfo"], hidden_kwargs["startupinfo"])

    def test_build_frontend_bundle_runs_node_entries_without_npm_shell(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = Path(temp_dir.name)
        web_dir = root / "apps" / "web"
        (web_dir / "node_modules" / "typescript" / "bin").mkdir(parents=True, exist_ok=True)
        (web_dir / "node_modules" / "vite" / "bin").mkdir(parents=True, exist_ok=True)
        (web_dir / "node_modules" / "typescript" / "bin" / "tsc").write_text("", encoding="utf-8")
        (web_dir / "node_modules" / "vite" / "bin" / "vite.js").write_text("", encoding="utf-8")

        config = SupervisorConfig(
            repo_root=root,
            app_home=root / "home",
            runtime_root=root / "runtime",
            releases_root=root / "runtime" / "releases",
            logs_dir=root / "logs",
            state_path=root / "home" / "supervisor-state.json",
        )
        supervisor = RuntimeSupervisor(config)

        with patch.object(supervisor, "_node_executable", return_value="D:\\node.exe"), patch.object(
            supervisor,
            "_run_logged_command",
        ) as run_logged_command:
            supervisor._build_frontend_bundle(release_id="rel1", env={"A": "B"})

        self.assertEqual(run_logged_command.call_count, 2)
        first_command = run_logged_command.call_args_list[0].kwargs["command"]
        second_command = run_logged_command.call_args_list[1].kwargs["command"]
        self.assertEqual(first_command, ["D:\\node.exe", str(web_dir / "node_modules" / "typescript" / "bin" / "tsc"), "-b"])
        self.assertEqual(second_command, ["D:\\node.exe", str(web_dir / "node_modules" / "vite" / "bin" / "vite.js"), "build"])

    def test_ensure_background_supervisor_passes_hidden_process_kwargs(self):
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
        hidden_kwargs = {"creationflags": 456, "startupinfo": object()}

        with patch(
            "memory_anki.supervisor.runtime_supervisor_support.build_supervisor_config",
            return_value=config,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.is_supervisor_healthy",
            side_effect=[False, True],
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.list_listening_pids",
            return_value=[],
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.wait_for_supervisor",
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.build_hidden_process_kwargs",
            return_value=hidden_kwargs,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.subprocess.Popen",
        ) as popen_mock, patch(
            "memory_anki.supervisor.runtime_supervisor_support.open_browser",
        ):
            ensure_background_supervisor()

        self.assertEqual(popen_mock.call_args.kwargs["creationflags"], 456)
        self.assertIs(popen_mock.call_args.kwargs["startupinfo"], hidden_kwargs["startupinfo"])

    def test_ensure_latest_workspace_runtime_builds_and_launches_current_workspace(self):
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
        (root / "apps" / "web").mkdir(parents=True, exist_ok=True)
        (root / "apps" / "api").mkdir(parents=True, exist_ok=True)
        hidden_kwargs = {"creationflags": 456, "startupinfo": object()}
        build_completed = subprocess.CompletedProcess(args=["npm", "run", "build"], returncode=0)
        process = MagicMock(pid=4321)

        with patch(
            "memory_anki.supervisor.runtime_supervisor_support.build_supervisor_config",
            return_value=config,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.list_listening_pids",
            return_value=[111],
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.kill_process_tree",
        ) as kill_process_tree, patch(
            "memory_anki.supervisor.runtime_supervisor_support._resolve_npm_command",
            return_value="npm.cmd",
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.build_hidden_process_kwargs",
            return_value=hidden_kwargs,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.subprocess.run",
            return_value=build_completed,
        ) as run_mock, patch(
            "memory_anki.supervisor.runtime_supervisor_support.subprocess.Popen",
            return_value=process,
        ) as popen_mock, patch(
            "memory_anki.supervisor.runtime_supervisor_support.wait_for_workspace_runtime",
        ) as wait_for_workspace_runtime, patch(
            "memory_anki.supervisor.runtime_supervisor_support.open_browser",
        ):
            runtime_supervisor_support.ensure_latest_workspace_runtime()

        kill_process_tree.assert_called_once_with(111)
        self.assertEqual(run_mock.call_args.args[0], ["npm.cmd", "run", "build"])
        self.assertEqual(run_mock.call_args.kwargs["cwd"], str(root / "apps" / "web"))
        self.assertEqual(
            popen_mock.call_args.kwargs["env"]["MEMORY_ANKI_WEB_DIST"],
            str(root / "apps" / "web" / "dist"),
        )
        self.assertEqual(
            popen_mock.call_args.kwargs["env"]["MEMORY_ANKI_CHANNEL"],
            RUN_MODE_WORKSPACE_LATEST,
        )
        self.assertNotIn("MEMORY_ANKI_RUNTIME_SNAPSHOT", popen_mock.call_args.kwargs["env"])
        wait_for_workspace_runtime.assert_called_once_with(config)

    def test_ensure_latest_workspace_runtime_raises_when_build_fails(self):
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
        (root / "apps" / "web").mkdir(parents=True, exist_ok=True)
        (root / "apps" / "api").mkdir(parents=True, exist_ok=True)
        failed_completed = subprocess.CompletedProcess(args=["npm", "run", "build"], returncode=2)

        with patch(
            "memory_anki.supervisor.runtime_supervisor_support.build_supervisor_config",
            return_value=config,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.list_listening_pids",
            return_value=[],
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support._resolve_npm_command",
            return_value="npm.cmd",
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.subprocess.run",
            return_value=failed_completed,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_support.subprocess.Popen",
        ) as popen_mock:
            with self.assertRaises(RuntimeError) as error:
                runtime_supervisor_support.ensure_latest_workspace_runtime(open_browser_after_launch=False)

        self.assertIn("Frontend build failed", str(error.exception))
        popen_mock.assert_not_called()

    def test_launch_defaults_to_workspace_latest_mode(self):
        with patch(
            "memory_anki.supervisor.runtime_supervisor.resolve_runtime_run_mode",
            return_value=RUN_MODE_WORKSPACE_LATEST,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor.ensure_latest_workspace_runtime",
        ) as ensure_latest_workspace_runtime, patch(
            "memory_anki.supervisor.runtime_supervisor.ensure_background_supervisor",
        ) as ensure_background_supervisor:
            exit_code = runtime_supervisor_support.sys.modules[
                "memory_anki.supervisor.runtime_supervisor"
            ].main(["--launch"])

        self.assertEqual(exit_code, 0)
        ensure_latest_workspace_runtime.assert_called_once_with(open_browser_after_launch=True)
        ensure_background_supervisor.assert_not_called()

    def test_launch_supports_legacy_supervisor_mode(self):
        with patch(
            "memory_anki.supervisor.runtime_supervisor.resolve_runtime_run_mode",
            return_value=RUN_MODE_SUPERVISOR,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor.ensure_latest_workspace_runtime",
        ) as ensure_latest_workspace_runtime, patch(
            "memory_anki.supervisor.runtime_supervisor.ensure_background_supervisor",
        ) as ensure_background_supervisor:
            exit_code = runtime_supervisor_support.sys.modules[
                "memory_anki.supervisor.runtime_supervisor"
            ].main(["--launch"])

        self.assertEqual(exit_code, 0)
        ensure_background_supervisor.assert_called_once_with(open_browser_after_launch=True)
        ensure_latest_workspace_runtime.assert_not_called()

    def test_start_release_backend_sets_pythonpath_for_release_snapshot(self):
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
        config.logs_dir.mkdir(parents=True, exist_ok=True)
        api_dir = config.releases_root / "rel-1" / "apps" / "api"
        api_dir.mkdir(parents=True, exist_ok=True)
        supervisor = RuntimeSupervisor(config)
        release = ReleaseRecord("rel-1", str(config.releases_root / "rel-1"), "fp-rel-1", 1, None)
        process = MagicMock(pid=4321)

        with patch.object(supervisor, "_find_free_port", return_value=18013), patch(
            "memory_anki.supervisor.runtime_supervisor.subprocess.Popen",
            return_value=process,
        ) as popen_mock, patch(
            "memory_anki.supervisor.runtime_supervisor.build_hidden_process_kwargs",
            return_value={},
        ):
            supervisor._start_release_backend(release)

        self.assertEqual(
            popen_mock.call_args.kwargs["env"]["PYTHONPATH"],
            str(api_dir / "src"),
        )
        self.assertEqual(
            popen_mock.call_args.args[0][4],
            str(api_dir / "src"),
        )
        self.assertEqual(release.port, 18013)
        self.assertEqual(release.process_id, 4321)

    def test_watch_loop_skips_candidate_build_when_watch_builds_disabled(self):
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
            poll_interval_seconds=0.01,
        )
        supervisor = RuntimeSupervisor(config)
        supervisor.last_repo_fingerprint = "old"
        supervisor._cleanup_releases = MagicMock()

        wait_results = iter([False, True])

        def fake_wait(_seconds: float) -> bool:
            return next(wait_results)

        with patch.object(supervisor.stop_event, "wait", side_effect=fake_wait), patch.object(
            supervisor,
            "_compute_source_fingerprint",
            return_value="new",
        ), patch.dict(os.environ, {"MEMORY_ANKI_DISABLE_WATCH_BUILDS": "1"}, clear=False), patch(
            "memory_anki.supervisor.runtime_supervisor_lifecycle.threading.Thread"
        ) as thread_cls:
            supervisor._watch_loop()

        thread_cls.assert_not_called()
        self.assertFalse(supervisor.building)

    def test_watch_loop_skips_new_build_while_candidate_exists(self):
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
            poll_interval_seconds=0.01,
        )
        supervisor = RuntimeSupervisor(config)
        supervisor.last_repo_fingerprint = "old"
        supervisor.candidate_release_id = "candidate-1"
        supervisor._cleanup_releases = MagicMock()

        wait_results = iter([False, True])

        def fake_wait(_seconds: float) -> bool:
            return next(wait_results)

        with patch.object(supervisor.stop_event, "wait", side_effect=fake_wait), patch.object(
            supervisor,
            "_compute_source_fingerprint",
            return_value="new",
        ), patch(
            "memory_anki.supervisor.runtime_supervisor_lifecycle.threading.Thread"
        ) as thread_cls:
            supervisor._watch_loop()

        thread_cls.assert_not_called()
        self.assertFalse(supervisor.building)

    def test_publish_release_cleans_up_failed_candidate_on_health_timeout(self):
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
        config.releases_root.mkdir(parents=True, exist_ok=True)
        supervisor = RuntimeSupervisor(config)

        with patch(
            "memory_anki.supervisor.runtime_supervisor.make_release_id",
            return_value="rel-timeout",
        ), patch.object(
            supervisor,
            "_compute_source_fingerprint",
            return_value="fp-new",
        ), patch.object(
            supervisor,
            "_load_runtime_generation",
            return_value=1,
        ), patch.object(
            supervisor,
            "_build_frontend_bundle",
        ), patch.object(
            supervisor,
            "_prepare_release",
        ), patch.object(
            supervisor,
            "_start_release_backend",
            side_effect=lambda release: setattr(release, "port", 18012),
        ), patch.object(
            supervisor,
            "_wait_for_backend_health",
            side_effect=TimeoutError("health timeout"),
        ), patch.object(
            supervisor,
            "_stop_release_process",
        ) as stop_release_process, patch.object(
            supervisor,
            "_copy_release_tree",
        ) as copy_release_tree:
            copy_release_tree.side_effect = lambda src, dst: Path(dst).mkdir(parents=True, exist_ok=True)
            with self.assertRaises(TimeoutError):
                supervisor._publish_release(promote_immediately=False)

        self.assertEqual(supervisor.releases, {})
        self.assertIsNone(supervisor.candidate_release_id)
        stop_release_process.assert_called_once_with("rel-timeout")
        self.assertFalse((config.releases_root / "rel-timeout").exists())

    def test_publish_release_protects_preparing_directory_from_orphan_cleanup(self):
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
        config.releases_root.mkdir(parents=True, exist_ok=True)
        supervisor = RuntimeSupervisor(config)

        def snapshot_release(release_dir: Path) -> None:
            (release_dir / "apps" / "api").mkdir(parents=True, exist_ok=True)

        def prepare_release(_release_dir: Path, _release_id: str) -> None:
            supervisor._cleanup_releases()

        def start_release_backend(release: ReleaseRecord) -> None:
            release.port = 18012

        def wait_for_backend_health(release: ReleaseRecord) -> None:
            release.ready = True

        with patch(
            "memory_anki.supervisor.runtime_supervisor.make_release_id",
            return_value="rel-pending",
        ), patch.object(
            supervisor,
            "_compute_source_fingerprint",
            return_value="fp-new",
        ), patch.object(
            supervisor,
            "_load_runtime_generation",
            return_value=1,
        ), patch.object(
            supervisor,
            "_build_frontend_bundle",
        ), patch.object(
            supervisor,
            "_snapshot_release",
            side_effect=snapshot_release,
        ), patch.object(
            supervisor,
            "_prepare_release",
            side_effect=prepare_release,
        ), patch.object(
            supervisor,
            "_start_release_backend",
            side_effect=start_release_backend,
        ), patch.object(
            supervisor,
            "_wait_for_backend_health",
            side_effect=wait_for_backend_health,
        ), patch(
            "memory_anki.supervisor.runtime_supervisor.list_active_runtime_instances",
            return_value=[],
        ):
            release = supervisor._publish_release(promote_immediately=False)

        self.assertEqual(release.release_id, "rel-pending")
        self.assertTrue((config.releases_root / "rel-pending").exists())
        self.assertEqual(supervisor.last_successful_release_id, "rel-pending")
        self.assertEqual(supervisor.pending_release_ids, set())

    def test_stop_release_process_kills_release_pid_without_popen_handle(self):
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
        supervisor = RuntimeSupervisor(config)
        supervisor.releases = {
            "rel-1": ReleaseRecord(
                "rel-1",
                str(config.releases_root / "rel-1"),
                "fp-rel-1",
                1,
                None,
                port=18012,
                process_id=4321,
                ready=True,
            )
        }

        with patch(
            "memory_anki.supervisor.runtime_supervisor.list_active_runtime_instances",
            return_value=[],
        ), patch(
            "memory_anki.supervisor.runtime_supervisor.kill_process_tree"
        ) as kill_process_tree:
            supervisor._stop_release_process("rel-1")

        kill_process_tree.assert_called_once_with(4321)
        self.assertIsNone(supervisor.releases["rel-1"].process_id)
        self.assertIsNone(supervisor.releases["rel-1"].port)
        self.assertFalse(supervisor.releases["rel-1"].ready)

    def test_stop_release_process_kills_active_instance_pid_for_release_snapshot(self):
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
        release_dir = config.releases_root / "rel-2"
        supervisor = RuntimeSupervisor(config)
        supervisor.releases = {
            "rel-2": ReleaseRecord(
                "rel-2",
                str(release_dir),
                "fp-rel-2",
                1,
                None,
                ready=True,
            )
        }

        with patch(
            "memory_anki.supervisor.runtime_supervisor.list_active_runtime_instances",
            return_value=[
                {"runtime_snapshot": str(release_dir), "pid": 5678},
                {"runtime_snapshot": str(config.releases_root / "other"), "pid": 8765},
            ],
        ), patch(
            "memory_anki.supervisor.runtime_supervisor.kill_process_tree"
        ) as kill_process_tree:
            supervisor._stop_release_process("rel-2")

        kill_process_tree.assert_called_once_with(5678)

    def test_reconcile_orphan_releases_kills_untracked_instances_and_directories(self):
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
        config.releases_root.mkdir(parents=True, exist_ok=True)
        tracked_dir = config.releases_root / "tracked"
        orphan_dir = config.releases_root / "orphan"
        tracked_dir.mkdir(parents=True, exist_ok=True)
        orphan_dir.mkdir(parents=True, exist_ok=True)

        supervisor = RuntimeSupervisor(config)
        supervisor.releases = {
            "tracked": ReleaseRecord("tracked", str(tracked_dir), "fp-tracked", 1, None, ready=True)
        }

        with patch(
            "memory_anki.supervisor.runtime_supervisor.list_active_runtime_instances",
            return_value=[
                {"runtime_snapshot": str(orphan_dir), "pid": 3210},
                {"runtime_snapshot": str(tracked_dir), "pid": 6543},
                {"runtime_snapshot": str(root / "outside-runtime"), "pid": 7777},
            ],
        ), patch(
            "memory_anki.supervisor.runtime_supervisor.kill_process_tree"
        ) as kill_process_tree:
            supervisor._reconcile_orphan_releases()

        kill_process_tree.assert_called_once_with(3210)
        self.assertTrue(tracked_dir.exists())
        self.assertFalse(orphan_dir.exists())

    def test_startup_diff_skips_candidate_build_when_watch_builds_disabled(self):
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
        supervisor = RuntimeSupervisor(config)
        supervisor.last_repo_fingerprint = "old"
        supervisor.current_release_id = "old"
        supervisor.releases = {
            "old": ReleaseRecord("old", str(root / "release"), "old", 1, None, port=18021, ready=True)
        }
        supervisor.release_sessions = {"old": {}}
        server = MagicMock()
        server.serve_forever.return_value = None

        with patch.object(supervisor, "load_state"), patch.object(
            supervisor,
            "_restore_saved_release",
            return_value=True,
        ), patch.object(
            supervisor,
            "_compute_source_fingerprint",
            return_value="new",
        ), patch.dict(os.environ, {"MEMORY_ANKI_DISABLE_WATCH_BUILDS": "1"}, clear=False), patch(
            "memory_anki.supervisor.runtime_supervisor_lifecycle.threading.Thread"
        ) as thread_cls, patch(
            "memory_anki.supervisor.runtime_supervisor_lifecycle.ThreadingHTTPServer",
            return_value=server,
        ):
            watcher_thread = MagicMock()
            thread_cls.return_value = watcher_thread
            supervisor.start()

        thread_cls.assert_called_once()
        self.assertEqual(thread_cls.call_args.kwargs["name"], "memory-anki-supervisor-watch")
        self.assertFalse(supervisor.building)


if __name__ == "__main__":
    unittest.main()
