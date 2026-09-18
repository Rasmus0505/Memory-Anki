"""Add first-learning schedule columns on palace quiz questions.

Revision ID: 0061_quiz_question_schedule
Revises: 0060_freestyle_round_workspace
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0061_quiz_question_schedule"
down_revision = "0060_freestyle_round_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "palace_quiz_questions",
        sa.Column("schedule_stage", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column("schedule_due_on", sa.Date(), nullable=True),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column("schedule_passed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "ix_palace_quiz_questions_schedule_due_on",
        "palace_quiz_questions",
        ["schedule_due_on"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_palace_quiz_questions_schedule_due_on",
        table_name="palace_quiz_questions",
    )
    op.drop_column("palace_quiz_questions", "schedule_passed")
    op.drop_column("palace_quiz_questions", "schedule_due_on")
    op.drop_column("palace_quiz_questions", "schedule_stage")
