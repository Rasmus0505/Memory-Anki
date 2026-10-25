"""Add the reminder delivery log.

Revision ID: 0079_reminder_deliveries
Revises: 0078_review_unit_intraday

Additive only. One row per <study day, slot>; the unique constraint is what
stops a restart or a second tick from sending the same reminder twice.
Dropping this table only forgets delivery history — it changes no schedule.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0079_reminder_deliveries"
down_revision = "0078_review_unit_intraday"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reminder_deliveries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("study_day", sa.Date(), nullable=False),
        sa.Column("slot", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("body", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("channel", sa.String(length=20), nullable=False, server_default="bark"),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "study_day", "slot", name="uq_reminder_deliveries_day_slot"
        ),
    )
    op.create_index(
        "ix_reminder_deliveries_created_at",
        "reminder_deliveries",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_reminder_deliveries_created_at", table_name="reminder_deliveries"
    )
    op.drop_table("reminder_deliveries")
