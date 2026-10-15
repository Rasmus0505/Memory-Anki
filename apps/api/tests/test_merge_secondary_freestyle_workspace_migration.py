"""Merging 随心2 into 随心: the secondary slot takes over, nothing is deleted.

The primary round displaced by a secondary active round is archived, not dropped.
The secondary feed settings become the primary settings.
"""

from __future__ import annotations

import importlib.util
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0072_merge_secondary_freestyle_workspace.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0072_merge_workspace", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load workspace merge migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tables(metadata: sa.MetaData):
    rounds = sa.Table(
        "freestyle_round_states",
        metadata,
        sa.Column("round_id", sa.String(128), primary_key=True),
        sa.Column("workspace", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("updated_at", sa.DateTime()),
    )
    config = sa.Table(
        "config",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(200), nullable=False, unique=True),
        sa.Column("value", sa.Text()),
        sa.Column("updated_at", sa.DateTime()),
    )
    return rounds, config


def _run(migration, connection) -> None:
    with patch.object(migration.op, "get_bind", return_value=connection):
        migration.upgrade()


def test_secondary_round_takes_primary_slot_and_displaced_round_is_archived():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    rounds, config = _tables(metadata)
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            rounds.insert(),
            [
                {"round_id": "primary-active", "workspace": "primary", "status": "active", "updated_at": datetime(2026, 10, 1)},
                {"round_id": "primary-done", "workspace": "primary", "status": "completed", "updated_at": datetime(2026, 9, 1)},
                {"round_id": "secondary-active", "workspace": "secondary", "status": "active", "updated_at": datetime(2026, 10, 2)},
                {"round_id": "secondary-done", "workspace": "secondary", "status": "completed", "updated_at": datetime(2026, 9, 2)},
                {"round_id": "palace-p5", "workspace": "p5", "status": "active", "updated_at": datetime(2026, 10, 3)},
            ],
        )
        _run(migration, connection)

    with engine.connect() as connection:
        rows = {
            row.round_id: (row.workspace, row.status)
            for row in connection.execute(sa.select(rounds))
        }

    assert rows["secondary-active"] == ("primary", "active")
    assert rows["primary-active"] == ("primary", "archived")
    assert rows["secondary-done"] == ("primary", "completed")
    assert rows["primary-done"] == ("primary", "completed")
    assert rows["palace-p5"] == ("p5", "active")


def test_secondary_feed_settings_replace_primary_and_secondary_key_is_removed():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    rounds, config = _tables(metadata)
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            config.insert(),
            [
                {"key": "freestyle_feed_config", "value": '{"queue": 20}', "updated_at": datetime(2026, 9, 1)},
                {"key": "freestyle_feed_config_secondary", "value": '{"queue": 45}', "updated_at": datetime(2026, 9, 2)},
            ],
        )
        _run(migration, connection)

    with engine.connect() as connection:
        rows = {row.key: row.value for row in connection.execute(sa.select(config))}

    assert rows == {"freestyle_feed_config": '{"queue": 45}'}


def test_missing_secondary_settings_leave_primary_untouched():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    rounds, config = _tables(metadata)
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            config.insert(),
            [{"key": "freestyle_feed_config", "value": '{"queue": 20}', "updated_at": datetime(2026, 9, 1)}],
        )
        _run(migration, connection)

    with engine.connect() as connection:
        rows = {row.key: row.value for row in connection.execute(sa.select(config))}

    assert rows == {"freestyle_feed_config": '{"queue": 20}'}
