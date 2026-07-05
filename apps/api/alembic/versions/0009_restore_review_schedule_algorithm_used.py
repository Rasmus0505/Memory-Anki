"""restore review schedule algorithm field

Revision ID: 0009_restore_review_schedule_algorithm_used
Revises: 0008_prune_deleted_features
"""

from __future__ import annotations

from alembic import op

revision = "0009_restore_review_schedule_algorithm_used"
down_revision = "0008_prune_deleted_features"
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


def _restore_review_schedule_algorithm_used() -> None:
    table_name = "review_schedules"
    column_name = "algorithm_used"
    if _column_exists(table_name, column_name):
        return

    bind = op.get_bind()
    bind.exec_driver_sql(
        f'ALTER TABLE "{table_name}" ADD COLUMN "{column_name}" VARCHAR(30)'
    )
    bind.exec_driver_sql(
        f'UPDATE "{table_name}" SET "{column_name}" = ? '
        f'WHERE "{column_name}" IS NULL OR "{column_name}" = ?',
        ("ebbinghaus", ""),
    )


def upgrade() -> None:
    _restore_review_schedule_algorithm_used()


def downgrade() -> None:
    return
