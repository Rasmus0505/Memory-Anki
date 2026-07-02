import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from memory_anki.core.local_config import (
    PLACEHOLDER_DEVICE_ID,
    load_local_runtime_config,
)


class LocalConfigTests(unittest.TestCase):
    def test_missing_config_keeps_sync_disabled_and_uses_default_home(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "local-config" / "memory-anki.local.json"
            default_home = Path(temp_dir) / "AppData" / "MemoryAnki"
            with patch.dict(os.environ, {"LOCALAPPDATA": str(default_home.parent)}, clear=False):
                config = load_local_runtime_config(
                    config_path=config_path,
                    repo_root=Path(temp_dir),
                    write_device_id=False,
                )

        self.assertFalse(config.config_exists)
        self.assertFalse(config.sync_enabled)
        self.assertEqual(config.local_app_home, default_home)
        self.assertIsNone(config.sync_root)

    def test_config_expands_paths_and_generates_device_id(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = root / "local-config" / "memory-anki.local.json"
            config_path.parent.mkdir(parents=True)
            config_path.write_text(
                json.dumps(
                    {
                        "device_id": PLACEHOLDER_DEVICE_ID,
                        "device_name": "Laptop",
                        "local_app_home": "%LOCALAPPDATA%/MemoryAnki",
                        "sync_root": "sync-folder",
                        "sync_enabled": True,
                        "conflict_policy": "block",
                        "sync_on_start": True,
                        "sync_on_stop": True,
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"LOCALAPPDATA": str(root / "LocalAppData")}, clear=False):
                config = load_local_runtime_config(config_path=config_path, repo_root=root)

            reloaded = json.loads(config_path.read_text(encoding="utf-8"))

        self.assertNotEqual(config.device_id, PLACEHOLDER_DEVICE_ID)
        self.assertEqual(reloaded["device_id"], config.device_id)
        self.assertEqual(config.local_app_home, root / "LocalAppData" / "MemoryAnki")
        self.assertEqual(config.sync_root, root / "sync-folder")
        self.assertTrue(config.sync_enabled)

    def test_dev_server_backend_env_uses_configured_app_home(self):
        repo_root = Path(__file__).resolve().parents[3]
        dev_server_path = repo_root / "tools" / "dev_server.py"
        spec = importlib.util.spec_from_file_location("memory_anki_test_dev_server", dev_server_path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)

        class DummyConfig:
            local_app_home = Path("D:/MemoryAnkiLocal")

        with patch.object(module, "_runtime_config", return_value=DummyConfig()):
            env = module._backend_env()

        self.assertEqual(env["MEMORY_ANKI_HOME"], "D:\\MemoryAnkiLocal")
        self.assertEqual(env["MEMORY_ANKI_STARTUP_MODE"], "serve")
        self.assertNotIn("MEMORY_ANKI_WEB_DIST", env)


if __name__ == "__main__":
    unittest.main()
