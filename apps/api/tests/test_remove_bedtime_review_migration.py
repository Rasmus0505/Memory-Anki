import importlib.util
import json
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0086_remove_bedtime_review.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0086_remove_bedtime_review", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load remove bedtime review migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_upgrade(connection):
    migration = _load_migration_module()
    with patch("alembic.op.get_bind", return_value=connection):
        migration.upgrade()


def test_upgrade_drops_bedtime_cards_and_plan_only_grades():
    engine = create_engine("sqlite:///:memory:")
    plan = {
        "original_cards": [
            {"card_id": "a", "unit_id": "ua"},
            {"card_id": "night", "unit_id": "un", "bedtime": True, "palace_pass": True},
        ],
        "presented_ids": ["a", "night"],
        "completed_ids": ["night"],
        "current_card_id": "night",
        "current_index": 1,
        "excluded_ids": [],
        "compressed_ids": [],
        "encounters": {"night": {"encounter_id": "e", "status": "open"}},
        "occurrences": [
            {"occurrence_id": "retry:1", "source_card_id": "night", "status": "inserted"}
        ],
        "bedtime_ratings": {"night": {"rating": 3, "rated_on": "2026-11-08"}},
    }
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE freestyle_round_states "
                "(round_id TEXT PRIMARY KEY, plan_json TEXT NOT NULL)"
            )
        )
        connection.execute(
            text("INSERT INTO freestyle_round_states VALUES (:rid, :plan)"),
            {"rid": "r1", "plan": json.dumps(plan)},
        )

        _run_upgrade(connection)

        stored = json.loads(
            connection.execute(
                text("SELECT plan_json FROM freestyle_round_states WHERE round_id = 'r1'")
            ).scalar_one()
        )

    assert [item["card_id"] for item in stored["original_cards"]] == ["a"]
    assert stored["presented_ids"] == ["a"]
    assert stored["completed_ids"] == []
    assert stored["encounters"] == {}
    assert stored["occurrences"] == []
    assert "bedtime_ratings" not in stored
    # The cursor must not point at a card that no longer exists.
    assert stored["current_card_id"] == "a"
    assert stored["current_index"] == 0


def test_upgrade_is_a_noop_without_a_round_table():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _run_upgrade(connection)
        assert "freestyle_round_states" not in inspect(connection).get_table_names()


def test_upgrade_keeps_plans_without_bedtime_content():
    engine = create_engine("sqlite:///:memory:")
    plan = {
        "original_cards": [{"card_id": "a", "unit_id": "ua"}],
        "presented_ids": ["a"],
        "completed_ids": [],
        "encounters": {},
    }
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE freestyle_round_states "
                "(round_id TEXT PRIMARY KEY, plan_json TEXT NOT NULL)"
            )
        )
        connection.execute(
            text("INSERT INTO freestyle_round_states VALUES (:rid, :plan)"),
            {"rid": "r1", "plan": json.dumps(plan)},
        )

        _run_upgrade(connection)

        stored = json.loads(
            connection.execute(
                text("SELECT plan_json FROM freestyle_round_states WHERE round_id = 'r1'")
            ).scalar_one()
        )

    assert stored == plan
