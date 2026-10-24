"""Migration 0077 adds the per-unit FSRS columns and stays reversible."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect

FSRS_COLUMNS = {
    "fsrs_stability",
    "fsrs_difficulty",
    "fsrs_state",
    "fsrs_step",
    "fsrs_due_at",
    "fsrs_last_review",
    "fsrs_scheduler_version",
}


def _load_migration():
    path = Path(__file__).parents[1] / "alembic/versions/0077_review_unit_fsrs.py"
    spec = importlib.util.spec_from_file_location("migration_0077", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fsrs_unit_migration_adds_and_drops_the_state_columns(db_session, monkeypatch):
    migration = _load_migration()
    connection = db_session.connection()
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )

    # The test schema already carries the ORM columns; start where 0076 left off.
    migration.downgrade()
    inspector = inspect(connection)
    assert FSRS_COLUMNS.isdisjoint(
        {column["name"] for column in inspector.get_columns("review_unit_states")}
    )

    migration.upgrade()
    inspector = inspect(connection)
    columns = {column["name"]: column for column in inspector.get_columns("review_unit_states")}
    assert FSRS_COLUMNS <= set(columns)
    # Additive and nullable: the backfill may run after the schema lands.
    for name in FSRS_COLUMNS:
        assert columns[name]["nullable"] is True

    migration.downgrade()
    inspector = inspect(connection)
    assert FSRS_COLUMNS.isdisjoint(
        {column["name"] for column in inspector.get_columns("review_unit_states")}
    )
