"""add composite indexes for freestyle/catalog read paths

Revision ID: 0042_db_read_path_indexes
Revises: 0041_normalize_study_session_local_wall_times
"""

from __future__ import annotations

from alembic import op

revision = "0042_db_read_path_indexes"
down_revision = "0041_normalize_study_session_local_wall_times"
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


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _index_exists(index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    _create_index_once(
        "ix_palaces_active_list",
        "palaces",
        ["deleted_at", "archived", "group_sort_order", "id"],
    )
    _create_index_once(
        "ix_palaces_deleted_archived_updated",
        "palaces",
        ["deleted_at", "archived", "updated_at"],
    )
    _create_index_once(
        "ix_palace_quiz_questions_chapter_published",
        "palace_quiz_questions",
        ["source_chapter_id", "lifecycle_status", "deleted_at"],
    )
    _create_index_once(
        "ix_palace_quiz_questions_palace_published_sort",
        "palace_quiz_questions",
        ["palace_id", "deleted_at", "lifecycle_status", "sort_order"],
    )


def downgrade() -> None:
    _drop_index_once(
        "ix_palace_quiz_questions_palace_published_sort",
        "palace_quiz_questions",
    )
    _drop_index_once(
        "ix_palace_quiz_questions_chapter_published",
        "palace_quiz_questions",
    )
    _drop_index_once("ix_palaces_deleted_archived_updated", "palaces")
    _drop_index_once("ix_palaces_active_list", "palaces")
