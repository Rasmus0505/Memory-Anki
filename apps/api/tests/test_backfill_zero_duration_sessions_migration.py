from __future__ import annotations

import importlib.util
import json
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0031_backfill_zero_duration_sessions.py"
    )
    spec = importlib.util.spec_from_file_location(
        "migration_0031_backfill_zero_duration_sessions",
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load zero-duration backfill migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tables(metadata: sa.MetaData):
    study_sessions = sa.Table(
        "study_sessions",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("target_type", sa.String(40), nullable=False),
        sa.Column("target_id", sa.Integer()),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime()),
        sa.Column("effective_seconds", sa.Integer(), nullable=False, default=0),
        sa.Column("summary_json", sa.Text(), nullable=False, default="{}"),
    )
    review_logs = sa.Table(
        "review_logs",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=False, default=0),
    )
    return study_sessions, review_logs


def test_backfills_only_trustworthy_zero_duration_records():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    study_sessions, review_logs = _tables(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            review_logs.insert(),
            [
                {"id": 1, "duration_seconds": 0},
                {"id": 2, "duration_seconds": 0},
            ],
        )
        connection.execute(
            study_sessions.insert(),
            [
                {
                    "id": "review-log-1",
                    "status": "completed",
                    "target_type": "review_schedule",
                    "target_id": 42,
                    "started_at": datetime(2026, 7, 13, 10, 40),
                    "ended_at": datetime(2026, 7, 13, 10, 40),
                    "effective_seconds": 0,
                    "summary_json": "{}",
                },
                {
                    "id": "session-progress-review-42",
                    "status": "abandoned",
                    "target_type": "review_schedule",
                    "target_id": 42,
                    "started_at": datetime(2026, 7, 13, 10, 0),
                    "ended_at": datetime(2026, 7, 13, 10, 40, 30),
                    "effective_seconds": 0,
                    "summary_json": "{}",
                },
                {
                    "id": "review-log-2",
                    "status": "completed",
                    "target_type": "review_schedule",
                    "target_id": 43,
                    "started_at": datetime(2026, 7, 14, 17, 0),
                    "ended_at": datetime(2026, 7, 14, 17, 0),
                    "effective_seconds": 0,
                    "summary_json": "{}",
                },
                {
                    "id": "session-progress-review-43",
                    "status": "abandoned",
                    "target_type": "review_schedule",
                    "target_id": 43,
                    "started_at": datetime(2026, 7, 13, 22, 0),
                    "ended_at": datetime(2026, 7, 14, 17, 0, 30),
                    "effective_seconds": 0,
                    "summary_json": "{}",
                },
                {
                    "id": "scene-segment-record",
                    "status": "completed",
                    "target_type": "none",
                    "target_id": None,
                    "started_at": datetime(2026, 7, 13, 11, 0),
                    "ended_at": datetime(2026, 7, 13, 11, 5),
                    "effective_seconds": 0,
                    "summary_json": json.dumps(
                        {
                            "scene_segments": [{"effectiveSeconds": 30}],
                            "duration_edited": False,
                        }
                    ),
                },
                {
                    "id": "pwa-wall-clock-record",
                    "status": "completed",
                    "target_type": "none",
                    "target_id": None,
                    "started_at": datetime(2026, 7, 13, 12, 0),
                    "ended_at": datetime(2026, 7, 13, 12, 1),
                    "effective_seconds": 0,
                    "summary_json": json.dumps(
                        {"client_source": "pwa", "duration_edited": False}
                    ),
                },
                {
                    "id": "manually-edited-record",
                    "status": "completed",
                    "target_type": "none",
                    "target_id": None,
                    "started_at": datetime(2026, 7, 13, 13, 0),
                    "ended_at": datetime(2026, 7, 13, 13, 10),
                    "effective_seconds": 0,
                    "summary_json": json.dumps(
                        {"client_source": "desktop", "duration_edited": True}
                    ),
                },
                {
                    "id": "existing-positive-record",
                    "status": "completed",
                    "target_type": "none",
                    "target_id": None,
                    "started_at": datetime(2026, 7, 13, 14, 0),
                    "ended_at": datetime(2026, 7, 13, 14, 10),
                    "effective_seconds": 50,
                    "summary_json": "{}",
                },
            ],
        )

        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()
            migration.upgrade()

        sessions = {
            row.id: row
            for row in connection.execute(sa.select(study_sessions)).mappings()
        }
        logs = {
            row.id: row.duration_seconds
            for row in connection.execute(sa.select(review_logs))
        }

    assert sessions["review-log-1"].effective_seconds == 2400
    assert sessions["review-log-1"].started_at == datetime(2026, 7, 13, 10, 0)
    assert logs[1] == 2400
    assert sessions["review-log-2"].effective_seconds == 0
    assert logs[2] == 0
    assert sessions["scene-segment-record"].effective_seconds == 30
    assert sessions["pwa-wall-clock-record"].effective_seconds == 60
    assert sessions["manually-edited-record"].effective_seconds == 0
    assert sessions["existing-positive-record"].effective_seconds == 50
    summary = json.loads(sessions["review-log-1"].summary_json)
    assert summary["duration_backfill"] == {
        "version": 1,
        "source": "review_progress_span",
        "effective_seconds": 2400,
    }
