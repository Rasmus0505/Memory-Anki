import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from memory_anki.core import runtime as runtime_module
from memory_anki.core import config as config_module
from memory_anki.modules.settings.presentation import router as settings_router


class RuntimeInfoTests(unittest.TestCase):
    def test_resolve_app_home_defaults_to_local_app_home(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            default_home = Path(temp_dir) / "MemoryAnki"
            (default_home / "shared-home.txt").parent.mkdir(parents=True, exist_ok=True)
            (default_home / "shared-home.txt").write_text("D:/ignored-runtime", encoding="utf-8")

            with patch.dict(os.environ, {}, clear=False), patch.object(
                config_module,
                "_default_app_home",
                return_value=default_home,
            ):
                os.environ.pop("MEMORY_ANKI_HOME", None)
                app_home, source = config_module._resolve_app_home()

        self.assertEqual(app_home, default_home)
        self.assertEqual(source, "default")

    def test_resolve_app_home_keeps_env_override(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            override_home = Path(temp_dir) / "custom-runtime"
            with patch.dict(os.environ, {"MEMORY_ANKI_HOME": str(override_home)}, clear=False):
                app_home, source = config_module._resolve_app_home()

        self.assertEqual(app_home, override_home)
        self.assertEqual(source, "env")

    def test_build_runtime_info_uses_env_commit_and_shared_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "migration-state.json"
            state_path.write_text(
                json.dumps(
                    {
                        "runtime_generation": 2,
                        "last_started_channel": "production",
                        "last_started_at": "2026-06-01T00:00:00+00:00",
                    }
                ),
                encoding="utf-8",
            )

            with patch.dict(
                os.environ,
                {
                    "MEMORY_ANKI_CHANNEL": "production",
                    "MEMORY_ANKI_GIT_COMMIT": "abcdef1234567890",
                },
                clear=False,
            ):
                info = runtime_module.build_runtime_info(path=state_path)

        self.assertEqual(info["channel"], "production")
        self.assertEqual(info["commit"], "abcdef1234567890")
        self.assertEqual(info["short_commit"], "abcdef12")
        self.assertEqual(info["runtime_generation"], 2)
        self.assertEqual(info["last_started_at"], "2026-06-01T00:00:00+00:00")
        self.assertIn("app_home", info)
        self.assertIn("app_home_source", info)
        self.assertIn("managed_storage_items", info)
        self.assertIn("backup_covered_items", info)
        self.assertIn("active_runtime_instances", info)

    def test_build_runtime_info_exposes_release_and_bundle_metadata(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            web_dist = Path(temp_dir) / "web-dist"
            web_dist.mkdir(parents=True, exist_ok=True)
            (web_dist / "index.html").write_text(
                '<!doctype html><script type="module" src="/assets/index-CPKO0nJg.js"></script>',
                encoding="utf-8",
            )

            with patch.dict(
                os.environ,
                {
                    "MEMORY_ANKI_RUNTIME_SNAPSHOT": str(Path(temp_dir) / "runtime" / "releases" / "rel-123"),
                    "MEMORY_ANKI_WEB_DIST": str(web_dist),
                },
                clear=False,
            ):
                info = runtime_module.build_runtime_info(state={})

        self.assertEqual(info["runtime_snapshot"], str(Path(temp_dir) / "runtime" / "releases" / "rel-123"))
        self.assertEqual(info["release_id"], "rel-123")
        self.assertEqual(info["frontend_entry_asset"], "index-CPKO0nJg.js")
        self.assertEqual(info["frontend_bundle_hash"], "CPKO0nJg")

    def test_build_runtime_health_returns_lightweight_readiness_payload(self):
        payload = runtime_module.build_runtime_health(
            state={"last_started_at": "2026-06-01T00:00:00+00:00"},
            startup_mode="healthcheck",
            runtime_snapshot="C:/runtime/releases/rel-456",
        )

        self.assertEqual(
            payload,
            {
                "ok": True,
                "startup_mode": "healthcheck",
                "runtime_snapshot": "C:/runtime/releases/rel-456",
                "release_id": "rel-456",
                "started_at": "2026-06-01T00:00:00+00:00",
            },
        )

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

        self.assertIn("Runtime data generation is newer", str(error.exception))

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
                channel="production",
                commit="fedcba9876543210",
                path=state_path,
            )
            reloaded = runtime_module.read_migration_state(state_path)

        self.assertEqual(persisted["runtime_generation"], 3)
        self.assertEqual(reloaded["runtime_generation"], 3)
        self.assertEqual(reloaded["last_started_channel"], "production")
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
                "channel": "production",
                "commit": "abcdef1234567890",
                "short_commit": "abcdef12",
                "runtime_generation": 1,
                "declared_runtime_generation": 1,
                "min_supported_generation": 1,
                "max_supported_generation": 1,
                "last_started_at": "2026-06-01T12:00:00+08:00",
                "app_home": "C:/Users/test/AppData/Local/MemoryAnki",
                "app_home_source": "default",
                "storage_mode": "user_app_home",
                "managed_storage_items": [],
                "backup_covered_items": [],
                "active_runtime_instances": [],
            },
        ):
            response = client.get("/api/v1/runtime-info")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["channel"], "production")
        self.assertEqual(response.json()["short_commit"], "abcdef12")

    def test_runtime_info_route_includes_release_metadata(self):
        app = FastAPI()
        app.include_router(settings_router.router, prefix="/api/v1")
        client = TestClient(app)

        with patch.object(
            settings_router,
            "build_runtime_info",
            return_value={
                "channel": "production",
                "commit": "abcdef1234567890",
                "short_commit": "abcdef12",
                "runtime_generation": 1,
                "declared_runtime_generation": 1,
                "min_supported_generation": 1,
                "max_supported_generation": 1,
                "last_started_at": "2026-06-01T12:00:00+08:00",
                "app_home": "C:/Users/test/AppData/Local/MemoryAnki",
                "app_home_source": "default",
                "runtime_snapshot": "C:/runtime/releases/rel-789",
                "release_id": "rel-789",
                "frontend_entry_asset": "index-CPKO0nJg.js",
                "frontend_bundle_hash": "CPKO0nJg",
                "storage_mode": "user_app_home",
                "managed_storage_items": [],
                "backup_covered_items": [],
                "active_runtime_instances": [],
            },
        ):
            response = client.get("/api/v1/runtime-info")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["release_id"], "rel-789")
        self.assertEqual(response.json()["frontend_bundle_hash"], "CPKO0nJg")

    def test_client_preferences_route_reads_and_writes_grouped_preferences(self):
        app = FastAPI()
        app.include_router(settings_router.router, prefix="/api/v1")
        client = TestClient(app)

        session_values: dict[str, str] = {}

        class FakeConfig:
            def __init__(self, key: str, value: str):
                self.key = key
                self.value = value
                self.updated_at = None

        class FakeQuery:
            def __init__(self, session):
                self.session = session
                self.key = None

            def filter_by(self, **kwargs):
                self.key = kwargs.get("key")
                return self

            def first(self):
                if self.key not in self.session.values:
                    return None
                return FakeConfig(self.key, self.session.values[self.key])

        class FakeSession:
            def __init__(self):
                self.values = session_values

            def query(self, _model):
                return FakeQuery(self)

            def add(self, row):
                self.values[row.key] = row.value

            def commit(self):
                return None

            def close(self):
                return None

        def override_session_dep():
            session = FakeSession()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[settings_router.session_dep] = override_session_dep

        response = client.put(
            "/api/v1/profile/client-preferences",
            json={
                "review_feedback_settings": {
                    "mode": "quiet",
                    "soundEnabled": False,
                    "animationEnabled": True,
                    "surpriseEnabled": False,
                }
            },
        )

        self.assertEqual(response.status_code, 200)
        get_response = client.get("/api/v1/profile/client-preferences")
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(
            get_response.json()["items"]["review_feedback_settings"]["mode"],
            "quiet",
        )


if __name__ == "__main__":
    unittest.main()
