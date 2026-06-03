import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from memory_anki.core import runtime as runtime_module
from memory_anki.modules.settings.presentation import router as settings_router


class RuntimeInfoTests(unittest.TestCase):
    def test_build_runtime_info_uses_env_commit_and_shared_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "migration-state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "runtime_generation": 2,
                        "last_started_channel": "stable",
                        "last_started_at": "2026-06-01T00:00:00+00:00",
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(
                os.environ,
                {
                    "MEMORY_ANKI_CHANNEL": "dev",
                    "MEMORY_ANKI_GIT_COMMIT": "abcdef1234567890",
                },
                clear=False,
            ):
                info = runtime_module.build_runtime_info(path=state_path)

        self.assertEqual(info["channel"], "dev")
        self.assertEqual(info["commit"], "abcdef1234567890")
        self.assertEqual(info["short_commit"], "abcdef12")
        self.assertEqual(info["runtime_generation"], 2)
        self.assertEqual(info["last_started_at"], "2026-06-01T00:00:00+00:00")

    def test_assert_runtime_compatible_rejects_newer_shared_generation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            contract_path = Path(temp_dir) / "runtime-contract.json"
            state_path = Path(temp_dir) / "migration-state.json"
            contract_path.write_text(
                json.dumps(
                    {
                        "runtime_generation": 1,
                        "min_supported_generation": 1,
                        "max_supported_generation": 1,
                    }
                ),
                encoding="utf-8",
            )
            state_path.write_text(json.dumps({"runtime_generation": 2}), encoding="utf-8")

            contract = runtime_module.load_runtime_contract(contract_path)

            with self.assertRaises(RuntimeError) as error:
                runtime_module.assert_runtime_compatible(contract, path=state_path)

        self.assertIn("Shared data generation is newer", str(error.exception))

    def test_record_runtime_start_persists_channel_commit_and_generation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "migration-state.json"
            contract_path = Path(temp_dir) / "runtime-contract.json"
            contract_path.write_text(
                json.dumps(
                    {
                        "runtime_generation": 3,
                        "min_supported_generation": 1,
                        "max_supported_generation": 3,
                    }
                ),
                encoding="utf-8",
            )
            state_path.write_text(json.dumps({"runtime_generation": 1}), encoding="utf-8")

            contract = runtime_module.load_runtime_contract(contract_path)
            persisted = runtime_module.record_runtime_start(
                contract,
                channel="stable",
                commit="fedcba9876543210",
                path=state_path,
            )
            reloaded = runtime_module.read_migration_state(state_path)

        self.assertEqual(persisted["runtime_generation"], 3)
        self.assertEqual(reloaded["runtime_generation"], 3)
        self.assertEqual(reloaded["last_started_channel"], "stable")
        self.assertEqual(reloaded["last_started_commit"], "fedcba9876543210")
        self.assertIn("last_started_at", reloaded)

    def test_runtime_info_route_returns_runtime_metadata(self):
        app = FastAPI()
        app.include_router(settings_router.router, prefix="/api/v1")
        client = TestClient(app)

        with patch.object(
            settings_router,
            "build_runtime_info",
            return_value={
                "channel": "stable",
                "commit": "abcdef1234567890",
                "short_commit": "abcdef12",
                "runtime_generation": 1,
                "declared_runtime_generation": 1,
                "min_supported_generation": 1,
                "max_supported_generation": 1,
                "last_started_at": "2026-06-01T12:00:00+08:00",
            },
        ):
            response = client.get("/api/v1/runtime-info")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["channel"], "stable")
        self.assertEqual(response.json()["short_commit"], "abcdef12")


if __name__ == "__main__":
    unittest.main()
