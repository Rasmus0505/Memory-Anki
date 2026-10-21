"""Permanently remove a review unit from scheduling.

Revision ID: 0074_unit_permanent_removal
Revises: 0073_freestyle_rating_intents

A unit removed with 永久移除 keeps its row (and its earned history) but is never
scheduled again. Additive only.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0074_unit_permanent_removal"
down_revision = "0073_freestyle_rating_intents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_unit_states",
        sa.Column("permanently_removed", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    with op.batch_alter_table("review_unit_states") as batch:
        batch.drop_column("permanently_removed")
