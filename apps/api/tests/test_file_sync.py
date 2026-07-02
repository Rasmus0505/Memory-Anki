import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from memory_anki.core.file_sync import pull_on_start, push_on_stop
from memory_anki.core.local_config import LocalRuntimeConfig


def make_config(temp_root: Path, device_id: str, device_name: str) -> LocalRuntimeConfig:
    return LocalRuntimeConfig(
        device_id=device_id,
        device_name=device_name,
        local_app_home=temp_root / device_name / "app-home",
        sync_root=temp_root / "sync-root",
        sync_enabled=True,
        conflict_policy="block",
        sync_on_start=True,
        sync_on_stop=True,
        config_path=temp_root / device_name / "memory-anki.local.json",
        config_exists=True,
    )


def write_runtime_payload(app_home: Path, value: str) -> None:
    data_dir = app_home / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "memory_palace.db").write_text(value, encoding="utf-8")
    (app_home / "migration-state.json").write_text(
        json.dumps({"runtime_generation": 1}),
        encoding="utf-8",
    )


def read_database(app_home: Path) -> str:
    return (app_home / "data" / "memory_palace.db").read_text(encoding="utf-8")


class FileSyncTests(unittest.TestCase):
    def test_two_devices_can_take_turns_pushing_and_pulling(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            device_a = make_config(root, "device-a", "LaptopA")
            device_b = make_config(root, "device-b", "LaptopB")

            write_runtime_payload(device_a.local_app_home, "alpha")
            first_push = push_on_stop(device_a)
            first_pull = pull_on_start(device_b)
            device_b_after_pull = read_database(device_b.local_app_home)

            write_runtime_payload(device_b.local_app_home, "beta")
            second_push = push_on_stop(device_b)
            second_pull = pull_on_start(device_a)

            remote_state = json.loads((root / "sync-root" / "state.json").read_text(encoding="utf-8"))
            device_a_database = read_database(device_a.local_app_home)

        self.assertTrue(first_push.ok, first_push.message)
        self.assertTrue(first_pull.ok, first_pull.message)
        self.assertEqual(device_b_after_pull, "alpha")
        self.assertTrue(second_push.ok, second_push.message)
        self.assertTrue(second_pull.ok, second_pull.message)
        self.assertEqual(device_a_database, "beta")
        self.assertEqual(remote_state["revision"], 2)

    def test_push_blocks_when_remote_and_local_both_changed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            device_a = make_config(root, "device-a", "LaptopA")
            device_b = make_config(root, "device-b", "LaptopB")

            write_runtime_payload(device_a.local_app_home, "base")
            self.assertTrue(push_on_stop(device_a).ok)
            self.assertTrue(pull_on_start(device_b).ok)

            write_runtime_payload(device_a.local_app_home, "device-a-change")
            self.assertTrue(push_on_stop(device_a).ok)

            write_runtime_payload(device_b.local_app_home, "device-b-change")
            conflict = push_on_stop(device_b)
            conflict_files = list((root / "sync-root" / "conflicts").glob("*.zip"))
            remote_state = json.loads((root / "sync-root" / "state.json").read_text(encoding="utf-8"))

        self.assertFalse(conflict.ok)
        self.assertEqual(conflict.status, "conflict")
        self.assertGreaterEqual(len(conflict_files), 1)
        self.assertEqual(remote_state["revision"], 2)

    def test_sync_snapshot_names_sanitize_device_names(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            device_a = make_config(root, "device-a", "DeviceA")
            device_b = make_config(root, "device-b", "DeviceB")
            device_a = replace(device_a, device_name="Desk/One: A")
            device_b = replace(device_b, device_name="Phone\\Two?")

            write_runtime_payload(device_a.local_app_home, "base")
            self.assertTrue(push_on_stop(device_a).ok)
            self.assertTrue(pull_on_start(device_b).ok)

            write_runtime_payload(device_a.local_app_home, "device-a-change")
            self.assertTrue(push_on_stop(device_a).ok)
            write_runtime_payload(device_b.local_app_home, "device-b-change")
            conflict = push_on_stop(device_b)

            snapshot_names = [path.name for path in (root / "sync-root" / "snapshots").glob("*.zip")]
            conflict_names = [path.name for path in (root / "sync-root" / "conflicts").glob("*.zip")]

        self.assertFalse(conflict.ok)
        self.assertTrue(snapshot_names)
        self.assertTrue(conflict_names)
        self.assertTrue(all("/" not in name and "\\" not in name and ":" not in name for name in snapshot_names))
        self.assertTrue(all("/" not in name and "\\" not in name and "?" not in name for name in conflict_names))


if __name__ == "__main__":
    unittest.main()
