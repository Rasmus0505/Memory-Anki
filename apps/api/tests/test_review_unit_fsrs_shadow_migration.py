"""Preserve FSRS history and retirement of shadow diagnostic tables."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect


def _load_migration(filename: str, revision: str):
    path = Path(__file__).parents[1] / f"alembic/versions/{filename}"
    spec = importlib.util.spec_from_file_location(revision, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _bind_operations(module, connection) -> None:
    module.op = Operations(MigrationContext.configure(connection))


def test_historical_shadow_migration_stays_unchanged(db_session):
    migration = _load_migration("0076_review_unit_fsrs_shadow.py", "migration_0076")

    assert migration.revision == "0076_review_unit_fsrs_shadow"
    assert migration.down_revision == "0075_unit_hard_penalty_day"


def test_forward_migration_removes_only_diagnostic_shadow_tables(db_session):
    migration = _load_migration(
        "0085_remove_review_unit_fsrs_shadow.py",
        "migration_0085",
    )
    connection = db_session.connection()
    _bind_operations(migration, connection)

    # Simulate an already migrated installation, without changing 0076's history.
    migration_0076 = _load_migration(
        "0076_review_unit_fsrs_shadow.py",
        "migration_0076_for_cleanup_test",
    )
    _bind_operations(migration_0076, connection)
    migration_0076.upgrade()
    assert inspect(connection).has_table("review_unit_fsrs_shadow_states")
    assert inspect(connection).has_table("review_unit_fsrs_shadow_ratings")

    connection.exec_driver_sql(
        "INSERT INTO review_unit_fsrs_shadow_states "
        "(unit_id, scheduler_version, desired_retention, maximum_interval, "
        "replayed_operations, created_at, updated_at) "
        "VALUES ('diagnostic-test-unit', 'test', 0.9, 36500, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    )
    connection.exec_driver_sql(
        "INSERT INTO review_unit_fsrs_shadow_ratings "
        "(id, unit_id, palace_id, rating, rated_at, study_day, ladder_stage_before, "
        "ladder_due_before, ladder_has_passed_before, ladder_stage_after, "
        "ladder_due_after, ladder_interval_days, fsrs_state_before_json, "
        "fsrs_state_after_json, fsrs_due_product, fsrs_interval_raw_days, "
        "fsrs_interval_days, due_delta_days, interval_delta_days, schedule_changed, "
        "schedule_locked, hard_penalized_today, hard_penalty_applied, fsrs_applied, "
        "horizon_applied, fuzz_applied, scheduler_version, created_at) "
        "VALUES ('diagnostic-test-rating', 'diagnostic-test-unit', 1, 3, "
        "CURRENT_TIMESTAMP, CURRENT_DATE, 0, CURRENT_DATE, 0, 1, CURRENT_DATE, 1, "
        "'{}', '{}', CURRENT_DATE, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 'test', CURRENT_TIMESTAMP)"
    )

    operation = _load_migration(
        "0085_remove_review_unit_fsrs_shadow.py",
        "migration_0085_repeat",
    )
    _bind_operations(operation, connection)
    operation.upgrade()
    operation.upgrade()  # already-cleaned databases are a no-op

    inspector = inspect(connection)
    assert not inspector.has_table("review_unit_fsrs_shadow_states")
    assert not inspector.has_table("review_unit_fsrs_shadow_ratings")
    assert inspector.has_table("review_unit_rating_operations")

    # Source history remains independently addressable and was never part of cleanup.
    connection.exec_driver_sql(
        "INSERT INTO review_unit_rating_operations "
        "(id, encounter_id, study_session_id, unit_id, palace_id, unit_revision, "
        "rating, passed, retry_after_cards, before_state_json, after_state_json, created_at) "
        "VALUES ('source-test-operation', 'source-test-encounter', 'source-test-session', "
        "'source-test-unit', 1, 1, 3, 1, 0, '{}', '{}', CURRENT_TIMESTAMP)"
    )
    assert connection.exec_driver_sql(
        "SELECT id FROM review_unit_rating_operations WHERE id = 'source-test-operation'"
    ).scalar_one() == "source-test-operation"
    assert migration.down_revision == "0084_review_unit_favorite"
