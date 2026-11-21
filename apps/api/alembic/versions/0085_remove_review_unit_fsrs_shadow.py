"""Retire the diagnostic FSRS shadow tables without touching rating history.

Revision ID: 0085_remove_review_unit_fsrs_shadow
Revises: 0084_review_unit_favorite

The two shadow tables contain disposable projections of rating operations. The
source-of-truth operation log in ``review_unit_rating_operations`` is retained.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0085_remove_review_unit_fsrs_shadow"
down_revision = "0084_review_unit_favorite"
branch_labels = None
depends_on = None

_SHADOW_TABLES = (
    "review_unit_fsrs_shadow_ratings",
    "review_unit_fsrs_shadow_states",
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table_name in _SHADOW_TABLES:
        if inspector.has_table(table_name):
            op.drop_table(table_name)
            inspector = sa.inspect(op.get_bind())


def downgrade() -> None:
    raise NotImplementedError(
        "FSRS shadow projections were retired; their derived rows cannot be restored."
    )
