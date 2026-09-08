"""Persist resumable freestyle round plans."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0059_freestyle_round_states"
down_revision = "0058_study_session_write_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "freestyle_round_states",
        sa.Column("round_id", sa.String(length=128), primary_key=True),
        sa.Column("scope_key", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("config_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("plan_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("current_card_id", sa.String(length=256), nullable=True),
        sa.Column("last_operation_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_freestyle_round_states_scope_status",
        "freestyle_round_states",
        ["scope_key", "status", "updated_at"],
    )
    op.create_index(
        "ix_freestyle_round_states_updated",
        "freestyle_round_states",
        ["updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_freestyle_round_states_updated", table_name="freestyle_round_states")
    op.drop_index("ix_freestyle_round_states_scope_status", table_name="freestyle_round_states")
    op.drop_table("freestyle_round_states")
