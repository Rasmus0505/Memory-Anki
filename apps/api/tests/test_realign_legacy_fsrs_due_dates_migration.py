import importlib.util
from datetime import date, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0037_realign_legacy_fsrs_due_dates.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0037", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tables(metadata: sa.MetaData):
    config = sa.Table(
        "config",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", sa.Text),
    )
    palaces = sa.Table(
        "palaces",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("created_at", sa.DateTime),
        sa.Column("deleted_at", sa.DateTime),
    )
    schedules = sa.Table(
        "review_schedules",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("palace_id", sa.Integer, nullable=False),
        sa.Column("scheduled_date", sa.Date, nullable=False),
        sa.Column("scheduled_at", sa.DateTime),
        sa.Column("review_type", sa.String(20)),
        sa.Column("review_number", sa.Integer),
        sa.Column("completed", sa.Boolean, nullable=False),
    )
    states = sa.Table(
        "review_node_states",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("palace_id", sa.Integer, nullable=False),
        sa.Column("node_uid", sa.String(128), nullable=False),
        sa.Column("state_source", sa.String(24), nullable=False),
        sa.Column("due_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    return config, palaces, schedules, states


def test_migration_realigns_legacy_only_and_skips_palaces_without_pending_schedule():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    config, palaces, schedules, states = _tables(metadata)
    metadata.create_all(engine)
    old_due = datetime(2026, 7, 7, 14, 48)
    manual_due = datetime(2026, 8, 5, 12, 0)

    with engine.begin() as connection:
        connection.execute(config.insert(), [{"id": 1, "key": "sleep_review_time", "value": "21:30"}])
        connection.execute(
            palaces.insert(),
            [
                {"id": 1, "created_at": datetime(2026, 7, 10, 14, 48)},
                {"id": 2, "created_at": datetime(2026, 7, 10, 9, 15)},
                {"id": 3, "created_at": datetime(2026, 7, 10, 8, 0)},
            ],
        )
        connection.execute(
            schedules.insert(),
            [
                {
                    "id": 10, "palace_id": 1, "scheduled_date": date(2026, 7, 17),
                    "scheduled_at": datetime(2026, 7, 17, 14, 48), "review_type": "standard",
                    "review_number": 1, "completed": False,
                },
                {
                    "id": 20, "palace_id": 2, "scheduled_date": date(2026, 7, 16),
                    "scheduled_at": None, "review_type": "1h", "review_number": 0,
                    "completed": False,
                },
            ],
        )
        connection.execute(
            states.insert(),
            [
                {"id": 1, "palace_id": 1, "node_uid": "legacy", "state_source": "legacy_estimate", "due_at": old_due, "updated_at": old_due},
                {"id": 2, "palace_id": 1, "node_uid": "manual", "state_source": "manual", "due_at": manual_due, "updated_at": old_due},
                {"id": 3, "palace_id": 2, "node_uid": "derived", "state_source": "legacy_estimate", "due_at": old_due, "updated_at": old_due},
                {"id": 4, "palace_id": 3, "node_uid": "no-pending", "state_source": "legacy_estimate", "due_at": old_due, "updated_at": old_due},
            ],
        )

        migration = load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        rows = {
            row.node_uid: row
            for row in connection.execute(sa.select(states)).mappings()
        }

    assert rows["legacy"].due_at == datetime(2026, 7, 17, 14, 48)
    assert rows["manual"].due_at == manual_due
    assert rows["manual"].updated_at == old_due
    assert rows["derived"].due_at == datetime(2026, 7, 16, 10, 15)
    assert rows["no-pending"].due_at == old_due
