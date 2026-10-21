"""Record the day a 困难 spent a unit's once-per-day demotion.

Revision ID: 0075_unit_hard_penalty_day
Revises: 0074_unit_permanent_removal

Without this marker, repeated 困难 on the same day's retry cards would keep
demoting the unit. Additive only; NULL means no demotion recorded.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0075_unit_hard_penalty_day"
down_revision = "0074_unit_permanent_removal"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_unit_states",
        sa.Column("hard_penalized_on", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table("review_unit_states") as batch:
        batch.drop_column("hard_penalized_on")
