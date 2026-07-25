"""temporary freestyle split marks

Revision ID: 0046_temporary_freestyle_marks
Revises: 0045_quiz_node_binding_target_palace_unique
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0046_temporary_freestyle_marks"
down_revision = "0045_quiz_node_binding_target_palace_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "freestyle_temporary_marks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "palace_id",
            sa.Integer(),
            sa.ForeignKey("palaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_uid", sa.String(length=128), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("palace_id", "node_uid", name="uq_freestyle_temp_marks_palace_node"),
    )
    op.create_index(
        "ix_freestyle_temp_marks_palace",
        "freestyle_temporary_marks",
        ["palace_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_freestyle_temp_marks_palace", table_name="freestyle_temporary_marks")
    op.drop_table("freestyle_temporary_marks")
