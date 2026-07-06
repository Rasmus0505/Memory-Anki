"""add database performance indexes

Revision ID: 0011_database_performance_indexes
Revises: 0010_palace_quiz_ocr_sources
"""

from __future__ import annotations

from alembic import op

revision = "0011_database_performance_indexes"
down_revision = "0010_palace_quiz_ocr_sources"
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


def _create_unique_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if not _table_exists(table_name) or _index_exists(index_name):
        return
    op.create_index(index_name, table_name, columns, unique=True)


def _drop_index_once(index_name: str) -> None:
    if not _index_exists(index_name):
        return
    op.drop_index(index_name)


def _deduplicate_chapter_palaces() -> None:
    if not _table_exists("chapter_palaces"):
        return
    bind = op.get_bind()
    bind.exec_driver_sql(
        "DELETE FROM chapter_palaces WHERE chapter_id IS NULL OR palace_id IS NULL"
    )
    duplicate_pairs = bind.exec_driver_sql(
        """
        SELECT chapter_id, palace_id, MIN(id) AS keep_id, MAX(COALESCE(is_explicit, 1)) AS keep_explicit
        FROM chapter_palaces
        GROUP BY chapter_id, palace_id
        HAVING COUNT(*) > 1
        """
    ).fetchall()
    for chapter_id, palace_id, keep_id, keep_explicit in duplicate_pairs:
        bind.exec_driver_sql(
            "UPDATE chapter_palaces SET is_explicit = ? WHERE id = ?",
            (keep_explicit, keep_id),
        )
        bind.exec_driver_sql(
            """
            DELETE FROM chapter_palaces
            WHERE chapter_id = ? AND palace_id = ? AND id <> ?
            """,
            (chapter_id, palace_id, keep_id),
        )


def upgrade() -> None:
    _create_index_once("ix_palaces_updated_at", "palaces", ["updated_at"])
    _create_index_once("ix_palaces_created_at_id", "palaces", ["created_at", "id"])
    _create_index_once("ix_palaces_primary_chapter_id", "palaces", ["primary_chapter_id"])
    _create_index_once("ix_palaces_mastered_archived", "palaces", ["mastered", "archived"])
    _create_index_once(
        "ix_pegs_palace_parent_sort",
        "pegs",
        ["palace_id", "parent_id", "sort_order"],
    )
    _create_index_once("ix_attachments_palace_id", "attachments", ["palace_id"])
    _create_index_once(
        "ix_review_logs_palace_date_id",
        "review_logs",
        ["palace_id", "review_date", "id"],
    )
    _create_index_once("ix_review_logs_date", "review_logs", ["review_date"])
    _deduplicate_chapter_palaces()
    _create_unique_index_once(
        "ux_chapter_palaces_chapter_palace",
        "chapter_palaces",
        ["chapter_id", "palace_id"],
    )
    _create_index_once(
        "ix_chapter_palaces_palace_chapter",
        "chapter_palaces",
        ["palace_id", "chapter_id"],
    )
    _create_index_once("ix_chapters_subject_sort", "chapters", ["subject_id", "sort_order"])
    _create_index_once("ix_chapters_parent_sort", "chapters", ["parent_id", "sort_order"])
    _create_index_once(
        "ix_study_sessions_deleted_started",
        "study_sessions",
        ["deleted_at", "started_at"],
    )


def downgrade() -> None:
    _drop_index_once("ix_study_sessions_deleted_started")
    _drop_index_once("ix_chapters_parent_sort")
    _drop_index_once("ix_chapters_subject_sort")
    _drop_index_once("ix_chapter_palaces_palace_chapter")
    _drop_index_once("ux_chapter_palaces_chapter_palace")
    _drop_index_once("ix_review_logs_date")
    _drop_index_once("ix_review_logs_palace_date_id")
    _drop_index_once("ix_attachments_palace_id")
    _drop_index_once("ix_pegs_palace_parent_sort")
    _drop_index_once("ix_palaces_mastered_archived")
    _drop_index_once("ix_palaces_primary_chapter_id")
    _drop_index_once("ix_palaces_created_at_id")
    _drop_index_once("ix_palaces_updated_at")
