"""quiz question to mindmap node bindings

Revision ID: 0038_quiz_question_node_bindings
Revises: 0037_realign_legacy_fsrs_due
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0038_quiz_question_node_bindings"
down_revision = "0037_realign_legacy_fsrs_due"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "palace_quiz_question_node_bindings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "palace_id",
            sa.Integer(),
            sa.ForeignKey("palaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            sa.Integer(),
            sa.ForeignKey("palace_quiz_questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_uid", sa.String(length=160), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="ai"),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "question_id",
            "node_uid",
            name="uq_quiz_question_node_binding",
        ),
    )
    op.create_index(
        "ix_quiz_question_node_bindings_palace_node",
        "palace_quiz_question_node_bindings",
        ["palace_id", "node_uid"],
    )
    op.create_index(
        "ix_quiz_question_node_bindings_question",
        "palace_quiz_question_node_bindings",
        ["question_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_quiz_question_node_bindings_question",
        table_name="palace_quiz_question_node_bindings",
    )
    op.drop_index(
        "ix_quiz_question_node_bindings_palace_node",
        table_name="palace_quiz_question_node_bindings",
    )
    op.drop_table("palace_quiz_question_node_bindings")
