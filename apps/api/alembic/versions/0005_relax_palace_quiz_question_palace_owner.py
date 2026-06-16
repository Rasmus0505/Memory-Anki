"""relax palace quiz question palace owner nullability

This aligns legacy SQLite databases with the current chapter-question model,
where chapter-owned quiz questions store ``source_chapter_id`` and may not
belong to any single palace row.

memory-anki: allow-destructive-migration
Justification: this historical SQLite-only nullability relaxation is required
to reconcile older local databases with the chapter-owned question model.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_relax_palace_quiz_question_palace_owner"
down_revision = "0004_chapter_quiz_question_ownership"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _column_notnull(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    rows = bind.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    for row in rows:
        if str(row[1]) == column_name:
            return bool(row[3])
    return False


def upgrade() -> None:
    if not _table_exists("palace_quiz_questions"):
        return
    if not _column_notnull("palace_quiz_questions", "palace_id"):
        return
    with op.batch_alter_table("palace_quiz_questions", recreate="always") as batch_op:
        batch_op.alter_column(
            "palace_id",
            existing_type=sa.Integer(),
            nullable=True,
        )


def downgrade() -> None:
    # SQLite legacy migrations in this repo do not restore prior nullability.
    pass
