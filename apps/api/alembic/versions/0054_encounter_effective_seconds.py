"""Persist client-observed foreground time for review encounters.

Revision ID: 0054_encounter_effective_seconds
Revises: 0053_add_initial_review_stage
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0054_encounter_effective_seconds"
down_revision = "0053_add_initial_review_stage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "review_unit_encounters",
        sa.Column("effective_seconds", sa.Integer(), nullable=True),
    )
    # Preserve only bounded, directly observable legacy wall-clock intervals.
    # Anything ambiguous stays NULL rather than being guessed as study time.
    op.execute(
        "UPDATE review_unit_encounters "
        "SET effective_seconds = CAST((julianday(closed_at) - julianday(created_at)) * 86400 AS INTEGER) "
        "WHERE status = 'closed' AND selected_rating IS NOT NULL "
        "AND created_at IS NOT NULL AND closed_at IS NOT NULL "
        "AND (julianday(closed_at) - julianday(created_at)) * 86400 BETWEEN 0 AND 14400"
    )


def downgrade() -> None:
    raise RuntimeError("0054 is a one-way timing correctness migration")
