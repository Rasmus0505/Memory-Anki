"""prune deleted feature tables

Revision ID: 0008_prune_deleted_features
Revises: 0007_study_sessions

memory-anki: allow-destructive-migration
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0008_prune_deleted_features"
down_revision = "0007_study_sessions"
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
    if not _table_exists(table_name):
        return False
    bind = op.get_bind()
    rows = bind.exec_driver_sql(f'PRAGMA table_info("{table_name}")').fetchall()
    return any(row[1] == column_name for row in rows)


def _drop_table_once(table_name: str) -> None:
    if _table_exists(table_name):
        op.drop_table(table_name)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if not _column_exists(table_name, column_name):
        return
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.drop_column(column_name)


def upgrade() -> None:
    for table_name in (
        "subject_documents",
        "node_connections",
        "time_records",
        "palace_segment_review_logs",
        "palace_segment_review_schedules",
        "palace_mini_palace_review_logs",
        "palace_mini_palace_review_schedules",
    ):
        _drop_table_once(table_name)

    _drop_column_once("palaces", "mini_review_mode")
    _drop_column_once("review_schedules", "algorithm_used")
    _drop_column_once("palace_segments", "algorithm_used")
    _drop_column_once("palace_mini_palaces", "algorithm_used")
    _drop_column_once("session_progress", "palace_segment_review_schedule_id")
    _drop_column_once("session_progress", "mini_palace_review_schedule_id")

    bind = op.get_bind()
    if _table_exists("config"):
        bind.execute(
            sa.text(
                """
                DELETE FROM config
                WHERE key IN (
                    'time_recording_threshold_seconds',
                    'default_algorithm',
                    'algorithm_change_scope'
                )
                """
            )
        )


def downgrade() -> None:
    return
