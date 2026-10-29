"""Add the lapse-recovery memory to review units.

Revision ID: 0081_review_unit_lapse_recovery
Revises: 0080_review_unit_early_step

A mature unit (previous gap of at least 14 days) that is rated 忘记 keeps the
interval it had earned. The overnight confirmation the next day restores a
fraction of that interval instead of restarting the card at one day. Both
columns are nullable: young cards never enter this state, and a NULL pair means
"no pending lapse".
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0081_review_unit_lapse_recovery"
down_revision = "0080_review_unit_early_step"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_unit_states",
        sa.Column("lapse_original_interval_days", sa.Integer(), nullable=True),
    )
    op.add_column(
        "review_unit_states",
        sa.Column("lapse_started_on", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table("review_unit_states") as batch:
        batch.drop_column("lapse_started_on")
        batch.drop_column("lapse_original_interval_days")
