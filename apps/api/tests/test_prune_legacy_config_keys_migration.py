import importlib.util
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, text


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0013_prune_legacy_config_keys.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0013_prune_legacy_config_keys", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load prune legacy config keys migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_deletes_only_legacy_config_keys():
    migration = _load_migration_module()
    engine = create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT)"))
        connection.execute(
            text("INSERT INTO config (key, value) VALUES (:key, :value)"),
            [
                {"key": "default_algorithm", "value": "legacy"},
                {"key": "algorithm_change_scope", "value": "legacy"},
                {"key": "custom_intervals", "value": "legacy"},
                {"key": "time_recording_threshold_seconds", "value": "legacy"},
                {"key": "flow_voice_api_key", "value": "legacy"},
                {"key": "flow_voice_base_url", "value": "legacy"},
                {"key": "flow_voice_model", "value": "legacy"},
                {"key": "flow_voice_voice", "value": "legacy"},
                {"key": "flow_voice_format", "value": "legacy"},
                {"key": "flow_voice_sample_rate", "value": "legacy"},
                {"key": "flow_voice_instruction", "value": "legacy"},
                {"key": "flow_voice_thinking_enabled", "value": "legacy"},
                {"key": "daily_max_reviews", "value": "20"},
            ],
        )

        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()

        remaining_keys = connection.execute(text("SELECT key FROM config ORDER BY key")).scalars().all()

    engine.dispose()

    assert remaining_keys == ["daily_max_reviews"]


def test_upgrade_skips_when_config_table_is_missing():
    migration = _load_migration_module()
    engine = create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()

    engine.dispose()
