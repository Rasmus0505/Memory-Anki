"""Migration 0076 only adds diagnostic tables; it must be reversible."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect


def _load_migration():
    path = Path(__file__).parents[1] / "alembic/versions/0076_review_unit_fsrs_shadow.py"
    spec = importlib.util.spec_from_file_location("migration_0076", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fsrs_shadow_migration_creates_and_drops_both_tables(db_session, monkeypatch):
    migration = _load_migration()
    connection = db_session.connection()
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )

    # The test schema already contains the ORM tables; start where 0075 left off.
    migration.downgrade()
    inspector = inspect(connection)
    assert not inspector.has_table("review_unit_fsrs_shadow_states")
    assert not inspector.has_table("review_unit_fsrs_shadow_ratings")

    migration.upgrade()
    inspector = inspect(connection)
    assert inspector.has_table("review_unit_fsrs_shadow_states")
    assert inspector.has_table("review_unit_fsrs_shadow_ratings")
    assert {
        "unit_id",
        "stability",
        "difficulty",
        "fsrs_state",
        "scheduler_version",
        "last_operation_id",
    } <= {
        column["name"]
        for column in inspector.get_columns("review_unit_fsrs_shadow_states")
    }
    assert {
        "id",
        "ladder_due_before",
        "ladder_due_after",
        "fsrs_due_product",
        "due_delta_days",
        "fsrs_applied",
    } <= {
        column["name"]
        for column in inspector.get_columns("review_unit_fsrs_shadow_ratings")
    }

    migration.downgrade()
    inspector = inspect(connection)
    assert not inspector.has_table("review_unit_fsrs_shadow_states")
    assert not inspector.has_table("review_unit_fsrs_shadow_ratings")
