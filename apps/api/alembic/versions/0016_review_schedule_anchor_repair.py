"""repair review schedule anchors

Revision ID: 0016_review_schedule_anchor_repair
Revises: 0015_review_log_notes
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "0016_review_schedule_anchor_repair"
down_revision = "0015_review_log_notes"
branch_labels = None
depends_on = None

REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY = "review_schedule_anchor_repair_v1"


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
    rows = bind.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if _table_exists(table_name) and not _column_exists(table_name, column.name):
        op.add_column(table_name, column)


def _ensure_soft_delete_columns_for_current_models() -> None:
    # The repair below imports current ORM models. Newer models expect the
    # soft-delete columns introduced by the next migration, so make this
    # migration safe for databases upgrading from 0015.
    _add_column_once("palaces", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_once(
        "palace_quiz_questions",
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )


def upgrade() -> None:
    from memory_anki.core.migration import is_app_migration_completed
    from memory_anki.modules.reviews.application.review_execution_service import (
        repair_review_stage_progress,
    )

    _ensure_soft_delete_columns_for_current_models()

    if is_app_migration_completed(REVIEW_SCHEDULE_REPAIR_MIGRATION_KEY):
        return

    bind = op.get_bind()
    with Session(bind=bind) as session:
        repair_review_stage_progress(session)


def downgrade() -> None:
    # Data repair is intentionally not reversible.
    return
