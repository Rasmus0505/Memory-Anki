"""Persist the current quiz 已做 cycle so a refresh does not clear it.

Revision ID: 0066_quiz_practice_progress
Revises: 0065_freestyle_round_operation_receipts
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0066_quiz_practice_progress"
down_revision = "0065_freestyle_round_operation_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quiz_practice_progress",
        sa.Column("question_id", sa.Integer(), primary_key=True),
        sa.Column("palace_id", sa.Integer(), nullable=True),
        sa.Column("state_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.String(length=40), nullable=False, server_default=""),
    )
    op.create_index(
        "ix_quiz_practice_progress_palace",
        "quiz_practice_progress",
        ["palace_id"],
    )
    op.create_table(
        "quiz_practice_progress_clears",
        sa.Column("scope_key", sa.String(length=48), primary_key=True),
        sa.Column("cleared_at", sa.String(length=40), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("quiz_practice_progress_clears")
    op.drop_index("ix_quiz_practice_progress_palace", table_name="quiz_practice_progress")
    op.drop_table("quiz_practice_progress")
