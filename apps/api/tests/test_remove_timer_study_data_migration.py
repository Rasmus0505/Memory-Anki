"""0070 removes timer-only study sessions and learning-time plan state."""

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
        / "0070_remove_timer_study_data.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0070_remove_timer_study_data", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load timer-removal migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine: sa.Engine, migration) -> None:
    with engine.begin() as connection:
        connection.execute(sa.text("PRAGMA foreign_keys=ON"))
        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()


def test_migration_chain_points_at_0069():
    migration = _load_migration_module()
    assert migration.down_revision == "0069_repair_beijing_offset_study_sessions"


def test_deletes_timer_sessions_keeps_review_sessions_and_cascade_is_safe():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE study_sessions (id TEXT PRIMARY KEY, scene TEXT NOT NULL)"))
        connection.execute(
            sa.text(
                "CREATE TABLE review_unit_encounters (id TEXT PRIMARY KEY, study_session_id TEXT "
                "REFERENCES study_sessions(id) ON DELETE CASCADE)"
            )
        )
        for sid, scene in [
            ("a", "formal_unit_review"),
            ("b", "freestyle_unit_review"),
            ("c", "manual"),
            ("d", "english_course"),
        ]:
            connection.execute(sa.text("INSERT INTO study_sessions VALUES (:i, :s)"), {"i": sid, "s": scene})
        connection.execute(sa.text("INSERT INTO review_unit_encounters VALUES ('e1', 'a')"))
        connection.execute(sa.text("INSERT INTO review_unit_encounters VALUES ('e2', 'b')"))

    _run(engine, migration)

    with engine.connect() as connection:
        ids = sorted(row[0] for row in connection.execute(sa.text("SELECT id FROM study_sessions")))
        encounters = connection.execute(sa.text("SELECT COUNT(*) FROM review_unit_encounters")).scalar()
    assert ids == ["a", "b"]
    assert encounters == 2


def test_strips_learning_time_from_round_plans_and_ignores_bad_json():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    plan = {
        "cards": [{"id": "x"}],
        "learning_time": {"total": 12},
        "partial_settlements": [
            {
                "total_effective_seconds": 5,
                "quiz_seconds": 2,
                "keep": 1,
                "palaces": [{"effective_seconds": 3, "id": "p"}],
            }
        ],
    }
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE freestyle_round_states (round_id TEXT PRIMARY KEY, plan_json TEXT)"))
        connection.execute(
            sa.text("INSERT INTO freestyle_round_states VALUES ('r1', :p)"),
            {"p": json.dumps(plan)},
        )
        connection.execute(sa.text("INSERT INTO freestyle_round_states VALUES ('r2', 'not json')"))

    _run(engine, migration)

    with engine.connect() as connection:
        rows = dict(connection.execute(sa.text("SELECT round_id, plan_json FROM freestyle_round_states")).all())
    cleaned = json.loads(rows["r1"])
    assert "learning_time" not in cleaned
    assert cleaned["cards"] == [{"id": "x"}]
    assert cleaned["partial_settlements"] == [{"keep": 1, "palaces": [{"id": "p"}]}]
    assert rows["r2"] == "not json"


def test_missing_tables_are_tolerated():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    _run(engine, migration)
