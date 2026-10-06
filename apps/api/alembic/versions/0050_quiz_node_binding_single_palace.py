"""Enforce single-palace quiz node bindings.

A quiz question belongs to exactly one palace, decided by the source chapter it
was recognized from. Cross-palace edges (question owned by palace A, bound onto
a node of palace B) are not a supported shape, so this revision deletes every
such row and restores the unique key that makes them impossible.

Revision ID: 0050_quiz_node_binding_single_palace
Revises: 0049_permanent_mark_review_units
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0050_quiz_node_binding_single_palace"
down_revision = "0049_permanent_mark_review_units"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Drop cross-palace edges: keep only rows whose target palace owns the question.
    conn.execute(
        sa.text(
            """
            DELETE FROM palace_quiz_question_node_bindings
            WHERE EXISTS (
                SELECT 1
                FROM palace_quiz_questions AS q
                WHERE q.id = palace_quiz_question_node_bindings.question_id
                  AND q.palace_id IS NOT NULL
                  AND q.palace_id <> palace_quiz_question_node_bindings.palace_id
            )
            """
        )
    )
    # Collapse duplicate (question_id, node_uid) rows left by multi-palace targets.
    conn.execute(
        sa.text(
            """
            DELETE FROM palace_quiz_question_node_bindings
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM palace_quiz_question_node_bindings
                GROUP BY question_id, node_uid
            )
            """
        )
    )
    with op.batch_alter_table("palace_quiz_question_node_bindings") as batch:
        batch.drop_constraint("uq_quiz_question_node_binding_target", type_="unique")
        batch.create_unique_constraint(
            "uq_quiz_question_node_binding",
            ["question_id", "node_uid"],
        )


def downgrade() -> None:
    with op.batch_alter_table("palace_quiz_question_node_bindings") as batch:
        batch.drop_constraint("uq_quiz_question_node_binding", type_="unique")
        batch.create_unique_constraint(
            "uq_quiz_question_node_binding_target",
            ["question_id", "palace_id", "node_uid"],
        )
