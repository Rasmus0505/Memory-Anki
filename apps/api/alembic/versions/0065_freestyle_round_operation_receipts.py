"""Durable freestyle round operation receipts.

Revision ID: 0065_freestyle_round_operation_receipts
Revises: 0064_exam_star_weights
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0065_freestyle_round_operation_receipts"
down_revision = "0064_exam_star_weights"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "freestyle_round_operation_receipts",
        sa.Column("operation_id", sa.String(length=128), primary_key=True),
        sa.Column("round_id", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_freestyle_round_operation_receipts_round",
        "freestyle_round_operation_receipts",
        ["round_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_freestyle_round_operation_receipts_round",
        table_name="freestyle_round_operation_receipts",
    )
    op.drop_table("freestyle_round_operation_receipts")
