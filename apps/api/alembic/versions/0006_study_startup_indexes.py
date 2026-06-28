"""add study startup indexes

Revision ID: 0006_study_startup_indexes
Revises: 0005_relax_palace_quiz_question_palace_owner
"""

from __future__ import annotations

from alembic import op

revision = "0006_study_startup_indexes"
down_revision = "0005_relax_palace_quiz_question_palace_owner"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
        (index_name,),
    ).fetchone()
    return row is not None


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _table_exists(table_name) or _index_exists(index_name):
        return
    op.create_index(index_name, table_name, columns)


def _drop_index_once(index_name: str) -> None:
    if not _index_exists(index_name):
        return
    op.drop_index(index_name)


def upgrade() -> None:
    _create_index_once(
        "ix_review_schedules_due_lookup",
        "review_schedules",
        ["completed", "scheduled_date", "scheduled_at", "id"],
    )
    _create_index_once(
        "ix_review_schedules_palace_progress",
        "review_schedules",
        ["palace_id", "completed", "review_number"],
    )
    _create_index_once(
        "ix_segment_review_schedules_due_lookup",
        "palace_segment_review_schedules",
        ["completed", "scheduled_date", "scheduled_at", "id"],
    )
    _create_index_once(
        "ix_mini_review_schedules_due_lookup",
        "palace_mini_palace_review_schedules",
        ["completed", "scheduled_date", "scheduled_at", "id"],
    )


def downgrade() -> None:
    _drop_index_once("ix_mini_review_schedules_due_lookup")
    _drop_index_once("ix_segment_review_schedules_due_lookup")
    _drop_index_once("ix_review_schedules_palace_progress")
    _drop_index_once("ix_review_schedules_due_lookup")
