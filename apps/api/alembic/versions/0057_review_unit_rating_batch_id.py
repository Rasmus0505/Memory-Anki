"""Link palace-due rating operations that share one undo batch.

Revision ID: 0057_review_unit_rating_batch_id
Revises: 0056_remove_legacy_ai_prompt_storage
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0057_review_unit_rating_batch_id"
down_revision = "0056_remove_legacy_ai_prompt_storage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_unit_rating_operations",
        sa.Column("batch_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_review_unit_rating_operations_batch",
        "review_unit_rating_operations",
        ["batch_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_review_unit_rating_operations_batch",
        table_name="review_unit_rating_operations",
    )
    op.drop_column("review_unit_rating_operations", "batch_id")
