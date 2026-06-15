import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from memory_anki.core import runtime_activity
from memory_anki.modules.backups.application import backup_lifecycle


class RuntimeActivityTests(unittest.TestCase):
    def test_start_and_stop_runtime_activity_heartbeat_manage_lease_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            active_dir = Path(temp_dir) / "active-instances"
            with patch.object(runtime_activity, "ACTIVE_RUNTIME_INSTANCES_DIR", active_dir):
                handle = runtime_activity.start_runtime_activity_heartbeat(
                    channel="production",
                    startup_mode="serve",
                )
                try:
                    instances = runtime_activity.list_active_runtime_instances()
                    self.assertEqual(len(instances), 1)
                    self.assertEqual(instances[0]["instance_id"], handle.instance_id)
                    self.assertEqual(instances[0]["channel"], "production")
                finally:
                    runtime_activity.stop_runtime_activity_heartbeat(handle)

                self.assertEqual(runtime_activity.list_active_runtime_instances(), [])

    def test_exclusive_runtime_operation_rejects_foreign_instance(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            active_dir = Path(temp_dir) / "active-instances"
            active_dir.mkdir(parents=True, exist_ok=True)
            foreign = active_dir / "foreign.json"
            foreign.write_text(
                '{"instance_id":"foreign","workspace":"D:/other-worktree","started_at":"2026-06-15T00:00:00+00:00"}',
                encoding="utf-8",
            )
            with patch.object(runtime_activity, "ACTIVE_RUNTIME_INSTANCES_DIR", active_dir):
                with self.assertRaises(RuntimeError) as error:
                    runtime_activity.assert_exclusive_runtime_operation(
                        "Database restore",
                        current_instance_id="current",
                    )
        self.assertIn("exclusive access", str(error.exception))
        self.assertIn("D:/other-worktree", str(error.exception))


class BackupLifecycleSafetyTests(unittest.TestCase):
    def test_restore_database_backup_checks_for_other_runtime_instances(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            backup_dir = Path(temp_dir) / "backup"
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / backup_lifecycle.DB_PATH.name).write_bytes(b"sqlite")

            with patch.object(
                backup_lifecycle,
                "assert_exclusive_runtime_operation",
                side_effect=RuntimeError("Close the other running Memory Anki instance first."),
            ), patch.object(
                backup_lifecycle,
                "create_rescue_snapshot",
            ) as rescue_snapshot, patch.object(
                backup_lifecycle,
                "restore_storage_backup",
            ) as restore_storage:
                with self.assertRaises(RuntimeError):
                    backup_lifecycle.restore_database_backup(str(backup_dir))

            rescue_snapshot.assert_not_called()
            restore_storage.assert_not_called()


if __name__ == "__main__":
    unittest.main()
