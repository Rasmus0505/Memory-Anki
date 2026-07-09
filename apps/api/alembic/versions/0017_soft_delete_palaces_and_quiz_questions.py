"""add soft delete columns to palaces and palace quiz questions

Revision ID: 0017_soft_delete_palaces_and_quiz_questions
Revises: 0016_review_schedule_anchor_repair
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_soft_delete_palaces_and_quiz_questions"
down_revision = "0016_review_schedule_anchor_repair"
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
    rows = bind.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)


def _index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
        (index_name,),
    ).fetchone()
    return row is not None


def _add_column_once(table_name: str, column: sa.Column) -> None:
    if _table_exists(table_name) and not _column_exists(table_name, column.name):
        op.add_column(table_name, column)


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if _table_exists(table_name) and not _index_exists(index_name):
        op.create_index(index_name, table_name, columns)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _index_exists(index_name):
        op.drop_index(index_name, table_name=table_name)


def _drop_column_once(table_name: str, column_name: str) -> None:
    if _table_exists(table_name) and _column_exists(table_name, column_name):
        op.drop_column(table_name, column_name)


def upgrade() -> None:
    _add_column_once("palaces", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _create_index_once("ix_palaces_deleted_at", "palaces", ["deleted_at"])

    _add_column_once(
        "palace_quiz_questions",
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    _create_index_once(
        "ix_palace_quiz_questions_deleted_at",
        "palace_quiz_questions",
        ["deleted_at"],
    )


def downgrade() -> None:
    _drop_index_once("ix_palace_quiz_questions_deleted_at", "palace_quiz_questions")
    _drop_column_once("palace_quiz_questions", "deleted_at")
    _drop_index_once("ix_palaces_deleted_at", "palaces")
    _drop_column_once("palaces", "deleted_at")
