import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
TOOLS_DIR = REPO_ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import dev_server  # noqa: E402


class DevServerMigrationPreflightTests(unittest.TestCase):
    def test_ensure_backend_migrations_applied_runs_before_backend_start(self):
        calls: list[str] = []

        def prepare_runtime():
            calls.append("prepare")

        def run_migration_preflight():
            calls.append("migrate")

        def start_backend():
            calls.append("backend")
            return SimpleNamespace(pid=123)

        with patch.object(dev_server, "sync_before_start", return_value=True), patch.object(
            dev_server,
            "ensure_backend_runtime_prepared",
            side_effect=prepare_runtime,
        ), patch.object(
            dev_server,
            "ensure_backend_migrations_applied",
            side_effect=run_migration_preflight,
        ), patch.object(
            dev_server,
            "start_backend",
            side_effect=start_backend,
        ), patch.object(
            dev_server,
            "wait_for_backend",
            return_value=False,
        ), patch.object(
            dev_server,
            "kill_process_tree",
        ), patch.object(
            dev_server,
            "free_port",
        ), patch.object(sys, "argv", ["dev_server.py"]):
            self.assertEqual(dev_server.main(), 1)

        self.assertEqual(calls, ["prepare", "migrate", "backend"])

    def test_main_stops_before_backend_when_migration_preflight_fails(self):
        with patch.object(dev_server, "sync_before_start", return_value=True), patch.object(
            dev_server,
            "ensure_backend_runtime_prepared",
        ), patch.object(
            dev_server,
            "ensure_backend_migrations_applied",
            side_effect=RuntimeError("migration failed"),
        ), patch.object(
            dev_server,
            "start_backend",
        ) as start_backend, patch.object(
            dev_server,
            "free_port",
        ), patch.object(sys, "argv", ["dev_server.py"]):
            self.assertEqual(dev_server.main(), 1)

        start_backend.assert_not_called()

    def test_ensure_backend_migrations_applied_raises_when_command_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(dev_server, "LOGS_DIR", Path(temp_dir)), patch.object(
                dev_server,
                "_backend_env",
                return_value={"PYTHONPATH": "src"},
            ), patch.object(
                dev_server.subprocess,
                "run",
                return_value=subprocess.CompletedProcess(args=[], returncode=7),
            ) as run:
                with self.assertRaises(RuntimeError) as error:
                    dev_server.ensure_backend_migrations_applied()

        self.assertIn("数据库迁移失败 (7)", str(error.exception))
        command = run.call_args.args[0]
        self.assertEqual(command[:2], [sys.executable, "-c"])
        self.assertIn("run_migrations", command[2])


if __name__ == "__main__":
    unittest.main()
