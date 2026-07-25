"""quiz node binding unique key includes target palace_id

Revision ID: 0045_quiz_node_binding_target_palace_unique
Revises: 0044_english_reading_gap_loop
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0045_quiz_node_binding_target_palace_unique"
down_revision = "0044_english_reading_gap_loop"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop legacy unique (question_id, node_uid) so the same node text uid
    # can exist under different target palaces without colliding.
    with op.batch_alter_table("palace_quiz_question_node_bindings") as batch:
        batch.drop_constraint("uq_quiz_question_node_binding", type_="unique")
        batch.create_unique_constraint(
            "uq_quiz_question_node_binding_target",
            ["question_id", "palace_id", "node_uid"],
        )


def downgrade() -> None:
    # Collapse any cross-palace collisions before restoring old uniqueness.
    conn = op.get_bind()
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
