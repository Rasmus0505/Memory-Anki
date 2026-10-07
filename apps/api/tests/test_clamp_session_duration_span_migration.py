"""Durations must fit inside their own recorded wall span.

`all_units_passed` sessions stamped ``ended_at`` after the final card had been
on screen, so the billed sum could exceed the stored span. Clamping must be
one-directional: a span *larger* than the duration is what paused and multi-day
sessions look like, and rewriting those would inflate study time enormously.
"""

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
        / "0068_clamp_session_duration_span.py"
    )
    spec = importlib.util.spec_from_file_location(
        "migration_0068_clamp_session_duration_span",
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load span-clamp migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _build(metadata: sa.MetaData):
    return sa.Table(
        "study_sessions",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime()),
        sa.Column("effective_seconds", sa.Integer(), nullable=False, default=0),
        sa.Column("summary_json", sa.Text(), nullable=False, default="{}"),
        sa.Column("deleted_at", sa.DateTime()),
    )


def _rows(connection, table):
    return {
        row.id: row
        for row in connection.execute(sa.select(table)).mappings()
    }


def _insert(connection, table, rows: list[dict]) -> None:
    """Insert rows one at a time so nullable columns keep their real values.

    A batched insert with heterogeneous keys leaves ``deleted_at`` unset for
    every row, which would silently make the soft-delete case untestable.
    """
    for row in rows:
        connection.execute(table.insert().values(**row))


def test_clamps_only_spans_smaller_than_the_recorded_duration():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    study_sessions = _build(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        _insert(
            connection,
            study_sessions,
            [
                {
                    # 1s rounding artifact: duration exceeds the span.
                    "id": "rounded",
                    "started_at": datetime(2026, 10, 5, 14, 52, 25),
                    "ended_at": datetime(2026, 10, 5, 14, 52, 27),
                    "effective_seconds": 3,
                    "summary_json": "{}",
                },
                {
                    # Real gap: 1020s billed inside a 2s span.
                    "id": "impossible",
                    "started_at": datetime(2026, 6, 6, 20, 10, 25),
                    "ended_at": datetime(2026, 6, 6, 20, 10, 27),
                    "effective_seconds": 1020,
                    "summary_json": "{}",
                },
                {
                    # span > duration: a paused / multi-day session. MUST NOT change.
                    "id": "paused",
                    "started_at": datetime(2026, 5, 8, 17, 7, 17),
                    "ended_at": datetime(2026, 5, 9, 17, 7, 17),
                    "effective_seconds": 418,
                    "summary_json": "{}",
                },
                {
                    # Already consistent.
                    "id": "exact",
                    "started_at": datetime(2026, 5, 8, 12, 54, 16),
                    "ended_at": datetime(2026, 5, 8, 12, 54, 17),
                    "effective_seconds": 1,
                    "summary_json": "{}",
                },
                {
                    # Hand-edited durations are user-owned.
                    "id": "edited",
                    "started_at": datetime(2026, 6, 6, 20, 10, 25),
                    "ended_at": datetime(2026, 6, 6, 20, 10, 27),
                    "effective_seconds": 900,
                    "summary_json": json.dumps({"duration_edited": True}),
                },
                {
                    # Soft-deleted rows are not touched.
                    "id": "deleted",
                    "started_at": datetime(2026, 6, 6, 20, 10, 25),
                    "ended_at": datetime(2026, 6, 6, 20, 10, 27),
                    "effective_seconds": 500,
                    "summary_json": "{}",
                    "deleted_at": datetime(2026, 6, 7, 0, 0, 0),
                },
                {
                    # Absurd span: reported, not rewritten.
                    "id": "broken-clock",
                    "started_at": datetime(2026, 6, 6, 0, 0, 0),
                    "ended_at": datetime(2026, 6, 7, 20, 0, 0),
                    "effective_seconds": 200_000,
                    "summary_json": "{}",
                },
            ],
        )
        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()
            migration.upgrade()  # idempotent

        rows = _rows(connection, study_sessions)

    assert rows["rounded"].effective_seconds == 2
    assert rows["impossible"].effective_seconds == 2

    # The critical guarantee: pausing must not be reinterpreted as study time.
    assert rows["paused"].effective_seconds == 418
    assert rows["exact"].effective_seconds == 1
    assert rows["edited"].effective_seconds == 900
    assert rows["deleted"].effective_seconds == 500
    assert rows["broken-clock"].effective_seconds == 200_000

    # Original numbers stay auditable.
    summary = json.loads(rows["impossible"].summary_json)
    assert summary["duration_span_repair"] == {
        "version": 1,
        "source": "wall_span_clamp",
        "previous_effective_seconds": 1020,
        "repaired_effective_seconds": 2,
        "rounding_only": False,
        "repaired_at": summary["duration_span_repair"]["repaired_at"],
    }
    assert json.loads(rows["rounded"].summary_json)["duration_span_repair"]["rounding_only"] is True
    assert "duration_span_repair" not in json.loads(rows["paused"].summary_json)
    assert "duration_span_repair" not in json.loads(rows["edited"].summary_json)


def test_downgrade_restores_the_previous_duration():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    study_sessions = _build(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        _insert(
            connection,
            study_sessions,
            [
                {
                    "id": "rounded",
                    "started_at": datetime(2026, 10, 5, 14, 52, 25),
                    "ended_at": datetime(2026, 10, 5, 14, 52, 27),
                    "effective_seconds": 3,
                    "summary_json": "{}",
                }
            ],
        )
        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()
            assert _rows(connection, study_sessions)["rounded"].effective_seconds == 2
            migration.downgrade()
            restored = _rows(connection, study_sessions)["rounded"]
            assert restored.effective_seconds == 3
            assert "duration_span_repair" not in json.loads(restored.summary_json)
