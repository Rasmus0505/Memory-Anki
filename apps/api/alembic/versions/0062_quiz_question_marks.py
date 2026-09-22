"""Add a quiz mark and backfill it from the last 忘记/困难 schedule.

Revision ID: 0062_quiz_question_marks
Revises: 0061_quiz_question_schedule
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0062_quiz_question_marks"
down_revision = "0061_quiz_question_schedule"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "palace_quiz_questions",
        sa.Column("marked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Last 忘记/困难: unpassed and a due date was written. Never-rated rows have
    # no due date. 记得/轻松 set schedule_passed. Earlier ratings were not kept.
    op.execute(
        """
        UPDATE palace_quiz_questions
        SET marked = 1
        WHERE schedule_due_on IS NOT NULL
          AND schedule_passed = 0
        """
    )


def downgrade() -> None:
    op.drop_column("palace_quiz_questions", "marked")
