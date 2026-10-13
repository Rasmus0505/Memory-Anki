"""Retiring the cohort unit kind must not leave stale cohort cards behind.

Cohort rows are deactivated (never deleted). Open unit-review sessions on the
affected palace are invalidated together with their open encounters, the SQL
form of the reconcile path. Other palaces and other scenes are left alone.
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
        / "0071_retire_cohort_review_units.py"
    )
    spec = importlib.util.spec_from_file_location(
        "migration_0071_retire_cohort_review_units",
        path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load cohort retirement migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tables(metadata: sa.MetaData) -> dict[str, sa.Table]:
    return {
        "review_unit_states": sa.Table(
            "review_unit_states",
            metadata,
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("palace_id", sa.Integer(), nullable=False),
            sa.Column("anchor_uid", sa.String(128), nullable=False),
            sa.Column("unit_kind", sa.String(16), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("updated_at", sa.DateTime()),
        ),
        "study_sessions": sa.Table(
            "study_sessions",
            metadata,
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("palace_id", sa.Integer()),
            sa.Column("scene", sa.String(64), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("ended_at", sa.DateTime()),
            sa.Column("completion_method", sa.String(64)),
            sa.Column("updated_at", sa.DateTime()),
        ),
        "review_unit_encounters": sa.Table(
            "review_unit_encounters",
            metadata,
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("study_session_id", sa.String(64), nullable=False),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("closed_at", sa.DateTime()),
        ),
    }


def test_retires_cohort_rows_and_invalidates_only_their_unit_sessions():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tables = _tables(metadata)
    metadata.create_all(engine)
    states = tables["review_unit_states"]
    sessions = tables["study_sessions"]
    encounters = tables["review_unit_encounters"]

    with engine.begin() as connection:
        connection.execute(
            states.insert(),
            [
                {"id": "cohort-1", "palace_id": 1, "anchor_uid": "A", "unit_kind": "cohort", "active": True},
                {"id": "mark-1", "palace_id": 1, "anchor_uid": "B1", "unit_kind": "mark", "active": True},
                {"id": "cohort-2", "palace_id": 2, "anchor_uid": "A", "unit_kind": "cohort", "active": True},
            ],
        )
        connection.execute(
            sessions.insert(),
            [
                # Palace 1 unit session holding a cohort: invalidated.
                {"id": "s-unit", "palace_id": 1, "scene": "freestyle_unit_review", "status": "active"},
                # Palace 1 non-unit scene: untouched.
                {"id": "s-other", "palace_id": 1, "scene": "palace_quiz", "status": "active"},
                # Palace 3 has no cohort: its unit session stays active.
                {"id": "s-clean", "palace_id": 3, "scene": "formal_unit_review", "status": "active"},
            ],
        )
        connection.execute(
            encounters.insert(),
            [
                {"id": "e-open", "study_session_id": "s-unit", "status": "open"},
                {"id": "e-clean", "study_session_id": "s-clean", "status": "open"},
            ],
        )

        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()

        active_states = {
            row.id: row.active
            for row in connection.execute(sa.select(states)).mappings()
        }
        assert active_states == {"cohort-1": False, "mark-1": True, "cohort-2": False}

        session_rows = {
            row.id: row
            for row in connection.execute(sa.select(sessions)).mappings()
        }
        assert session_rows["s-unit"]["status"] == "invalidated"
        assert session_rows["s-unit"]["completion_method"] == "unit_topology_changed"
        assert isinstance(session_rows["s-unit"]["ended_at"], datetime)
        assert session_rows["s-other"]["status"] == "active"
        assert session_rows["s-clean"]["status"] == "active"

        encounter_rows = {
            row.id: row
            for row in connection.execute(sa.select(encounters)).mappings()
        }
        assert encounter_rows["e-open"]["status"] == "closed"
        assert encounter_rows["e-clean"]["status"] == "open"


def test_is_a_noop_without_cohort_rows_and_downgrade_keeps_data():
    migration = _load_migration_module()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tables = _tables(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            tables["review_unit_states"].insert(),
            [{"id": "mark-1", "palace_id": 1, "anchor_uid": "B1", "unit_kind": "mark", "active": True}],
        )
        with patch.object(migration.op, "get_bind", return_value=connection):
            migration.upgrade()
            migration.downgrade()
        states = connection.execute(sa.select(tables["review_unit_states"])).mappings().all()
        assert [(row.id, row.active) for row in states] == [("mark-1", True)]
