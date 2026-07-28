"""Add content-reconcile schedule batch checkpoints for undo.

Revision ID: 0052_review_unit_schedule_batches
Revises: 0051_remove_node_review_history
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0052_review_unit_schedule_batches"
down_revision = "0051_remove_node_review_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_unit_schedule_batches",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "palace_id",
            sa.Integer(),
            sa.ForeignKey("palaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.String(32), nullable=False, server_default="content_reconcile"),
        sa.Column("entries_json", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("undone_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_review_unit_schedule_batches_palace",
        "review_unit_schedule_batches",
        ["palace_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_review_unit_schedule_batches_palace",
        table_name="review_unit_schedule_batches",
    )
    op.drop_table("review_unit_schedule_batches")
