"""Server-side 未保存 rating intents for freestyle rounds.

Revision ID: 0073_freestyle_rating_intents
Revises: 0072_merge_secondary_freestyle_workspace

A rating whose save failed is kept on the server so it survives a reload and
shows up on every device that opens the same round. Additive only: no existing
table is changed.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0073_freestyle_rating_intents"
down_revision = "0072_merge_secondary_freestyle_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "freestyle_rating_intents",
        sa.Column("round_id", sa.String(length=128), primary_key=True),
        sa.Column("card_id", sa.String(length=256), primary_key=True),
        sa.Column("operation_id", sa.String(length=128), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("failure", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_freestyle_rating_intents_round",
        "freestyle_rating_intents",
        ["round_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_freestyle_rating_intents_round", table_name="freestyle_rating_intents")
    op.drop_table("freestyle_rating_intents")
