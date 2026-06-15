"""add chapter ownership fields to palace quiz questions"""

from __future__ import annotations

from alembic import op

revision = "0004_chapter_quiz_question_ownership"
down_revision = "0003_reset_english_reading_dictionary_cache"
branch_labels = None
depends_on = None


def _table_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    rows = bind.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row[1]) for row in rows}


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists("palace_quiz_questions"):
        return
    columns = _table_columns("palace_quiz_questions")
    if "source_chapter_id" not in columns:
        bind.exec_driver_sql(
            "ALTER TABLE palace_quiz_questions ADD COLUMN source_chapter_id INTEGER NULL"
        )
    if "classified_chapter_id" not in columns:
        bind.exec_driver_sql(
            "ALTER TABLE palace_quiz_questions ADD COLUMN classified_chapter_id INTEGER NULL"
        )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_palace_quiz_questions_source_chapter "
        "ON palace_quiz_questions (source_chapter_id)"
    )
    bind.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_palace_quiz_questions_classified_chapter "
        "ON palace_quiz_questions (classified_chapter_id)"
    )


def downgrade() -> None:
    # SQLite legacy migrations in this repo do not drop columns in downgrade.
    pass
