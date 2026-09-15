"""Add independent freestyle workspace slots.

Revision ID: 0060_freestyle_round_workspace
Revises: 0059_freestyle_round_states
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0060_freestyle_round_workspace"
down_revision = "0059_freestyle_round_states"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "freestyle_round_states",
        sa.Column(
            "workspace",
            sa.String(length=20),
            nullable=False,
            server_default="primary",
        ),
    )
    op.create_index(
        "ix_freestyle_round_states_workspace_scope_status",
        "freestyle_round_states",
        ["workspace", "scope_key", "status", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_freestyle_round_states_workspace_scope_status",
        table_name="freestyle_round_states",
    )
    op.drop_column("freestyle_round_states", "workspace")
