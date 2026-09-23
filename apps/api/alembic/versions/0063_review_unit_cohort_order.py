"""Let one anchor host a mark cohort beside its isolation unit.

Revision ID: 0063_review_unit_cohort_order
Revises: 0062_quiz_question_marks
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0063_review_unit_cohort_order"
down_revision = "0062_quiz_question_marks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_unit_states",
        sa.Column("topology_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute("DROP INDEX IF EXISTS uq_review_unit_states_active_anchor")
    op.execute(
        "CREATE UNIQUE INDEX uq_review_unit_states_active_anchor "
        "ON review_unit_states (palace_id, anchor_uid, unit_kind) WHERE active = 1"
    )


def downgrade() -> None:
    op.execute("DELETE FROM review_unit_states WHERE unit_kind = 'cohort'")
    op.execute("DROP INDEX IF EXISTS uq_review_unit_states_active_anchor")
    op.execute(
        "CREATE UNIQUE INDEX uq_review_unit_states_active_anchor "
        "ON review_unit_states (palace_id, anchor_uid) WHERE active = 1"
    )
    op.drop_column("review_unit_states", "topology_order")
