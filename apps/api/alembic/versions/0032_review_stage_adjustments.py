"""add review stage adjustment audit records

Revision ID: 0032_review_stage_adjustments
Revises: 0031_backfill_zero_duration_sessions
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0032_review_stage_adjustments"
down_revision = "0031_backfill_zero_duration_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_stage_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "palace_id",
            sa.Integer(),
            sa.ForeignKey("palaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("previous_completed_count", sa.Integer(), nullable=False),
        sa.Column("target_completed_count", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("needs_practice", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_review_stage_adjustments_palace_created",
        "review_stage_adjustments",
        ["palace_id", "created_at", "id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_review_stage_adjustments_palace_created",
        table_name="review_stage_adjustments",
    )
    op.drop_table("review_stage_adjustments")
