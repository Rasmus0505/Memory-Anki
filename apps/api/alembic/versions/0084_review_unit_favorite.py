"""Add independent favorites to permanent-mark review units.

Revision ID: 0084_review_unit_favorite
Revises: 0083_palace_favorite
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0084_review_unit_favorite"
down_revision = "0083_palace_favorite"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_unit_states",
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "ix_review_unit_states_palace_favorite",
        "review_unit_states",
        ["palace_id", "active", "is_favorite"],
    )


def downgrade() -> None:
    op.drop_index("ix_review_unit_states_palace_favorite", table_name="review_unit_states")
    with op.batch_alter_table("review_unit_states") as batch:
        batch.drop_column("is_favorite")
