"""palace review waves, dual due dates, calibration ops

Revision ID: 0043_palace_review_waves
Revises: 0042_db_read_path_indexes
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0043_palace_review_waves"
down_revision = "0042_db_read_path_indexes"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    rows = bind.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return any(str(row[1]) == column_name for row in rows)


def _index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
        (index_name,),
    ).fetchone()
    return row is not None


def upgrade() -> None:
    if not _table_exists("review_waves"):
        op.create_table(
            "review_waves",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("wave_type", sa.String(32), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="scheduled"),
            sa.Column("local_date", sa.Date(), nullable=True),
            sa.Column("available_at", sa.DateTime(), nullable=True),
            sa.Column("frozen_at", sa.DateTime(), nullable=True),
            sa.Column("paused_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("active_session_id", sa.String(64), nullable=True),
            sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("rated_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_review_waves_palace_status", "review_waves", ["palace_id", "status"])
        op.create_index(
            "ix_review_waves_palace_type_date",
            "review_waves",
            ["palace_id", "wave_type", "local_date"],
        )
        op.create_index(
            "ix_review_waves_palace_available",
            "review_waves",
            ["palace_id", "wave_type", "available_at"],
        )
        # Partial unique: one active formal wave per palace.
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_review_waves_palace_active_formal "
            "ON review_waves (palace_id) "
            "WHERE wave_type = 'formal_long_term' AND status IN ('active', 'paused')"
        )
        # One scheduled formal wave per palace local day.
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_review_waves_palace_formal_day "
            "ON review_waves (palace_id, local_date) "
            "WHERE wave_type = 'formal_long_term' AND local_date IS NOT NULL "
            "AND status IN ('scheduled', 'active', 'paused')"
        )

    if not _table_exists("review_wave_items"):
        op.create_table(
            "review_wave_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("wave_id", sa.String(64), sa.ForeignKey("review_waves.id", ondelete="CASCADE"), nullable=False),
            sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("node_uid", sa.String(128), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
            sa.Column("evidence_origin", sa.String(24), nullable=True),
            sa.Column("rating", sa.Integer(), nullable=True),
            sa.Column("rated_at", sa.DateTime(), nullable=True),
            sa.Column("rating_operation_id", sa.String(64), nullable=True),
            sa.Column("frozen_raw_due_at", sa.DateTime(), nullable=True),
            sa.Column("frozen_effective_due_at", sa.DateTime(), nullable=True),
            sa.Column("included_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("wave_id", "node_uid", name="uq_review_wave_items_wave_node"),
        )
        op.create_index(
            "ix_review_wave_items_palace_node",
            "review_wave_items",
            ["palace_id", "node_uid"],
        )
        op.create_index(
            "ix_review_wave_items_wave_status",
            "review_wave_items",
            ["wave_id", "status"],
        )

    if not _table_exists("review_calibration_operations"):
        op.create_table(
            "review_calibration_operations",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("mode", sa.String(24), nullable=False),
            sa.Column("scope_kind", sa.String(16), nullable=False),
            sa.Column("scope_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("baseline_tier", sa.String(24), nullable=True),
            sa.Column("palace_revision", sa.String(64), nullable=True),
            sa.Column("preview_only", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("undone_at", sa.DateTime(), nullable=True),
            sa.Column("affected_node_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            "ix_review_calibration_ops_palace_created",
            "review_calibration_operations",
            ["palace_id", "created_at"],
        )

    if not _table_exists("review_calibration_operation_items"):
        op.create_table(
            "review_calibration_operation_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "operation_id",
                sa.String(64),
                sa.ForeignKey("review_calibration_operations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("node_uid", sa.String(128), nullable=False),
            sa.Column("before_state_json", sa.Text(), nullable=False),
            sa.Column("after_state_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("operation_id", "node_uid", name="uq_review_calibration_items_node"),
        )
        op.create_index(
            "ix_review_calibration_items_palace_node",
            "review_calibration_operation_items",
            ["palace_id", "node_uid"],
        )

    # Extend review_node_states (conservative: copy due_at → raw_due_at).
    if _table_exists("review_node_states"):
        columns = [
            ("raw_due_at", sa.Column("raw_due_at", sa.DateTime(), nullable=True)),
            ("last_direct_review_at", sa.Column("last_direct_review_at", sa.DateTime(), nullable=True)),
            ("last_practice_at", sa.Column("last_practice_at", sa.DateTime(), nullable=True)),
            ("schedule_source", sa.Column("schedule_source", sa.String(32), nullable=False, server_default="new")),
            ("evidence_source", sa.Column("evidence_source", sa.String(24), nullable=False, server_default="none")),
            ("effective_wave_id", sa.Column("effective_wave_id", sa.String(64), nullable=True)),
            ("effective_local_date", sa.Column("effective_local_date", sa.Date(), nullable=True)),
            ("schedule_reason", sa.Column("schedule_reason", sa.String(128), nullable=True)),
        ]
        for name, col in columns:
            if not _column_exists("review_node_states", name):
                op.add_column("review_node_states", col)

        if not _index_exists("ix_review_node_states_wave"):
            op.create_index("ix_review_node_states_wave", "review_node_states", ["effective_wave_id"])
        if not _index_exists("ix_review_node_states_schedule_source"):
            op.create_index(
                "ix_review_node_states_schedule_source",
                "review_node_states",
                ["palace_id", "schedule_source"],
            )

        # Backfill raw_due_at from due_at; set schedule_source for existing cards.
        op.execute(
            "UPDATE review_node_states SET raw_due_at = due_at "
            "WHERE raw_due_at IS NULL AND due_at IS NOT NULL"
        )
        op.execute(
            "UPDATE review_node_states SET schedule_source = 'manual' "
            "WHERE last_review_at IS NOT NULL AND (schedule_source IS NULL OR schedule_source = 'new')"
        )
        op.execute(
            "UPDATE review_node_states SET schedule_source = 'uninitialized' "
            "WHERE last_review_at IS NULL AND (schedule_source IS NULL OR schedule_source = 'new')"
        )
        bind = op.get_bind()
        rows = bind.exec_driver_sql(
            """
            SELECT palace_id, node_uid, raw_due_at, due_at
            FROM review_node_states
            WHERE last_review_at IS NOT NULL
              AND due_at IS NOT NULL
              AND schedule_source NOT IN ('uninitialized', 'content_changed')
            """
        ).fetchall()
        grouped: dict[tuple[int, str], list[tuple[str, object, object]]] = {}
        for palace_id, node_uid, raw_due_at, due_at in rows:
            parsed_due = (
                due_at
                if isinstance(due_at, datetime)
                else datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
            )
            if parsed_due.tzinfo is None:
                parsed_due = parsed_due.replace(tzinfo=UTC)
            local_day = parsed_due.astimezone().date().isoformat()
            grouped.setdefault((int(palace_id), local_day), []).append(
                (str(node_uid), raw_due_at, due_at)
            )

        now = datetime.now(UTC).replace(tzinfo=None)
        for (palace_id, local_day), items in grouped.items():
            wave_id = f"mig-wave-{palace_id}-{local_day}"
            bind.exec_driver_sql(
                """
                INSERT INTO review_waves (
                    id, palace_id, wave_type, status, local_date,
                    item_count, rated_count, created_at, updated_at
                ) VALUES (?, ?, 'formal_long_term', 'scheduled', ?, ?, 0, ?, ?)
                """,
                (wave_id, palace_id, local_day, len(items), now, now),
            )
            for node_uid, raw_due_at, due_at in items:
                bind.exec_driver_sql(
                    """
                    UPDATE review_node_states
                    SET effective_wave_id = ?, effective_local_date = ?,
                        schedule_reason = 'migration_group_by_due_day'
                    WHERE palace_id = ? AND node_uid = ?
                    """,
                    (wave_id, local_day, palace_id, node_uid),
                )
                bind.exec_driver_sql(
                    """
                    INSERT INTO review_wave_items (
                        wave_id, palace_id, node_uid, status,
                        frozen_raw_due_at, frozen_effective_due_at,
                        included_at, created_at, updated_at
                    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
                    """,
                    (wave_id, palace_id, node_uid, raw_due_at, due_at, now, now, now),
                )

    # Default reinforcement config keys (minutes).
    if _table_exists("config"):
        op.execute(
            "INSERT OR IGNORE INTO config (key, value) VALUES "
            "('reinforcement_again_minutes', '20'), "
            "('reinforcement_hard_minutes', '60')"
        )


def downgrade() -> None:
    if _table_exists("review_calibration_operation_items"):
        op.drop_table("review_calibration_operation_items")
    if _table_exists("review_calibration_operations"):
        op.drop_table("review_calibration_operations")
    if _table_exists("review_wave_items"):
        op.drop_table("review_wave_items")
    if _table_exists("review_waves"):
        op.execute("DROP INDEX IF EXISTS uq_review_waves_palace_active_formal")
        op.execute("DROP INDEX IF EXISTS uq_review_waves_palace_formal_day")
        op.drop_table("review_waves")

    for name in (
        "schedule_reason",
        "effective_local_date",
        "effective_wave_id",
        "evidence_source",
        "schedule_source",
        "last_practice_at",
        "last_direct_review_at",
        "raw_due_at",
    ):
        if _table_exists("review_node_states") and _column_exists("review_node_states", name):
            op.drop_column("review_node_states", name)
