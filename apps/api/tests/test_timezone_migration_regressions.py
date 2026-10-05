from __future__ import annotations

import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _load(name: str, filename: str):
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_0041_explicit_offset_is_not_shifted_by_host_timezone():
    migration = _load("migration_0041", "0041_normalize_study_session_local_wall_times.py")
    parsed = migration._parse_datetime("2026-07-22T01:00:00+08:00")
    assert parsed is not None and parsed.tzinfo is not None
    assert migration._to_utc_naive(parsed) == datetime(2026, 7, 21, 17, 0)


def test_0041_naive_value_remains_host_local_wall_conversion():
    migration = _load("migration_0041_naive", "0041_normalize_study_session_local_wall_times.py")
    parsed = migration._parse_datetime("2026-07-22T01:00:00")
    assert parsed == datetime(2026, 7, 22, 1, 0)
    # Historical desktop producer timezone is fixed to Asia/Shanghai.
    assert migration._to_utc_naive(parsed) == datetime(2026, 7, 21, 17, 0)


def test_0031_explicit_offset_normalizes_to_utc_not_local_wall():
    migration = _load("migration_0031", "0031_backfill_zero_duration_sessions.py")
    assert migration._parse_datetime("2026-07-22T01:00:00+08:00") == datetime(2026, 7, 21, 17, 0)


def test_0031_aware_datetime_object_normalizes_to_utc():
    migration = _load("migration_0031_aware_object", "0031_backfill_zero_duration_sessions.py")
    value = datetime(2026, 7, 22, 1, tzinfo=timezone(timedelta(hours=8)))
    assert migration._parse_datetime(value) == datetime(2026, 7, 21, 17, 0)


def test_review_progress_explicit_offset_normalizes_to_utc():
    from memory_anki.modules.content.application.review_progress_datetime import (
        parse_progress_datetime,
        serialize_stage_datetime,
    )

    value = parse_progress_datetime("2026-07-22T01:00:00+08:00")
    assert value == datetime(2026, 7, 21, 17, 0)
    assert serialize_stage_datetime(value) == "2026-07-21T17:00+00:00"


def test_0041_upgrade_converts_client_local_session_without_name_error():
    from unittest.mock import patch

    import sqlalchemy as sa

    migration = _load("migration_0041_upgrade", "0041_normalize_study_session_local_wall_times.py")
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sessions = sa.Table(
        "study_sessions",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("started_at", sa.String()),
        sa.Column("ended_at", sa.String()),
        sa.Column("deleted_at", sa.String()),
        sa.Column("created_at", sa.String()),
        sa.Column("updated_at", sa.String()),
        sa.Column("completion_method", sa.String()),
        sa.Column("summary_json", sa.Text()),
        sa.Column("events_json", sa.Text()),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            sessions.insert(),
            {
                "id": "client-local",
                "started_at": "2026-07-22T01:00:00",
                "ended_at": "2026-07-22T01:30:00",
                "deleted_at": None,
                "created_at": "2026-07-22T01:00:00",
                "updated_at": "2026-07-22T01:30:00",
                "completion_method": "saved",
                "summary_json": '{"client_source":"desktop"}',
                "events_json": "[]",
            },
        )
        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()
        row = connection.execute(sa.select(sessions)).mappings().one()

    assert row["started_at"] == "2026-07-21 17:00:00"
    assert row["ended_at"] == "2026-07-21 17:30:00"
    assert row["deleted_at"] is None
    assert migration.MIGRATION_FLAG in row["summary_json"]
