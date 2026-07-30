from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0055_remove_migrated_review_log_duplicates.py"
    )
    spec = importlib.util.spec_from_file_location(
        "migration_0055_remove_migrated_review_log_duplicates",
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load duplicate time-record cleanup migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_removes_only_retired_review_log_projections_and_is_idempotent():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    study_sessions = sa.Table(
        "study_sessions",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("completion_method", sa.String(32), nullable=False),
        sa.Column("summary_json", sa.Text(), nullable=False, default="{}"),
    )
    metadata.create_all(engine)

    rows = [
        {
            "id": "review-log-1",
            "completion_method": "migrated_review_log",
            "summary_json": json.dumps({"migrated_from": "review_logs"}),
        },
        {
            "id": "time-record-review-log-1",
            "completion_method": "manual_complete",
            "summary_json": json.dumps({"migrated_from": "time_records"}),
        },
        {
            "id": "formal-review-source",
            "completion_method": "manual_complete",
            "summary_json": json.dumps(
                {"completion_receipt": {"review_log_id": 1}}
            ),
        },
        {
            "id": "unrelated-migration",
            "completion_method": "migrated_review_log",
            "summary_json": json.dumps({"migrated_from": "other"}),
        },
    ]
    with engine.begin() as connection:
        connection.execute(study_sessions.insert(), rows)
        with patch.object(migration.op, "get_bind", return_value=connection):
            # The migration uses op.execute, so patch that operation onto this
            # isolated connection and prove running twice remains safe.
            with patch.object(migration.op, "execute", side_effect=connection.exec_driver_sql):
                migration.upgrade()
                migration.upgrade()
        remaining = {
            row.id for row in connection.execute(sa.select(study_sessions)).mappings()
        }

    assert remaining == {
        "time-record-review-log-1",
        "formal-review-source",
        "unrelated-migration",
    }
