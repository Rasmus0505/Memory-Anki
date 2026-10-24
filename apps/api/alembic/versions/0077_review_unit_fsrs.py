"""Make FSRS the production scheduler for palace review units.

Revision ID: 0077_review_unit_fsrs
Revises: 0076_review_unit_fsrs_shadow

Additive only. The columns hold the FSRS card state per unit; the one-time
history backfill runs at application startup and can be re-run safely. Existing
``stage_index`` and ``due_date`` remain the learner-visible projection.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0077_review_unit_fsrs"
down_revision = "0076_review_unit_fsrs_shadow"
branch_labels = None
depends_on = None

_COLUMNS = (
    sa.Column("fsrs_stability", sa.Float(), nullable=True),
    sa.Column("fsrs_difficulty", sa.Float(), nullable=True),
    sa.Column("fsrs_state", sa.Integer(), nullable=True),
    sa.Column("fsrs_step", sa.Integer(), nullable=True),
    sa.Column("fsrs_due_at", sa.DateTime(), nullable=True),
    sa.Column("fsrs_last_review", sa.DateTime(), nullable=True),
    sa.Column("fsrs_scheduler_version", sa.String(length=32), nullable=True),
)


def upgrade() -> None:
    for column in _COLUMNS:
        op.add_column("review_unit_states", column)


def downgrade() -> None:
    with op.batch_alter_table("review_unit_states") as batch:
        for column in reversed(_COLUMNS):
            batch.drop_column(column.name)
