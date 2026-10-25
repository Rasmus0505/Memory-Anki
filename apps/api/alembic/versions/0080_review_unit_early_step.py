"""Add the fixed early-ladder step counter to review units.

Revision ID: 0080_review_unit_early_step
Revises: 0079_reminder_deliveries

The fixed early ladder is the product's first four reviews (30 minutes, then
day 2, day 3 and day 5). Its booked gaps repeat (one day twice), so the counter
cannot be derived from the previous gap alone; this column records how many
day-level fixed reviews the unit has completed. NULL means "not recorded yet",
and the scheduler infers a legacy position from the booked gap before the
first rating under the new policy.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0080_review_unit_early_step"
down_revision = "0079_reminder_deliveries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_unit_states",
        sa.Column("early_step", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table("review_unit_states") as batch:
        batch.drop_column("early_step")
