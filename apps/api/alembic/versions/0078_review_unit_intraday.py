"""Add the same-day (intra-day) spacing fields to review units.

Revision ID: 0078_review_unit_intraday
Revises: 0077_review_unit_fsrs

Additive and nullable/defaulted. FSRS still owns the day-level due date; these
columns only say when a unit may be served again *within* the same study day
(the 15-minute first-pass re-check and the 10m/1h/3h retry ladder).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0078_review_unit_intraday"
down_revision = "0077_review_unit_fsrs"
branch_labels = None
depends_on = None

_COLUMNS = (
    sa.Column("intraday_due_at", sa.DateTime(), nullable=True),
    sa.Column("intraday_day", sa.Date(), nullable=True),
    sa.Column("intraday_retries", sa.Integer(), nullable=False, server_default=sa.text("0")),
    sa.Column(
        "intraday_step_pending",
        sa.Boolean(),
        nullable=False,
        server_default=sa.text("0"),
    ),
)


def upgrade() -> None:
    for column in _COLUMNS:
        op.add_column("review_unit_states", column)


def downgrade() -> None:
    with op.batch_alter_table("review_unit_states") as batch:
        for column in reversed(_COLUMNS):
            batch.drop_column(column.name)
