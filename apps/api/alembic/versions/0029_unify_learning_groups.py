"""unify mini palace divisions into learning groups

Revision ID: 0029_unify_learning_groups
Revises: 0028_remove_focus_practice
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# memory-anki: allow-destructive-migration — mini-palace divisions and their session progress are intentionally retired.

revision = "0029_unify_learning_groups"
down_revision = "0028_remove_focus_practice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("palace_segments") as batch_op:
        batch_op.add_column(
            sa.Column("needs_practice", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    op.create_table(
        "palace_quiz_question_segments",
        sa.Column(
            "question_id",
            sa.Integer(),
            sa.ForeignKey("palace_quiz_questions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "segment_id",
            sa.Integer(),
            sa.ForeignKey("palace_segments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_quiz_question_segments_segment_question",
        "palace_quiz_question_segments",
        ["segment_id", "question_id"],
    )

    op.execute("UPDATE palace_quiz_questions SET mini_palace_id = NULL WHERE mini_palace_id IS NOT NULL")
    op.execute("DELETE FROM session_progress WHERE session_kind = 'mini_practice'")
    op.execute("DELETE FROM palace_mini_palaces")


def downgrade() -> None:
    op.drop_index(
        "ix_quiz_question_segments_segment_question",
        table_name="palace_quiz_question_segments",
    )
    op.drop_table("palace_quiz_question_segments")
    with op.batch_alter_table("palace_segments") as batch_op:
        batch_op.drop_column("needs_practice")
