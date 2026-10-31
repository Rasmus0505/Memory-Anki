"""Add AI variant history and muscle-memory marking to quiz questions.

Revision ID: 0082_quiz_question_variants
Revises: 0081_review_unit_lapse_recovery

The question row always keeps the original content. AI variants live in
``variant_history_json`` and ``active_variant_id`` selects which content the
practice surfaces display. ``mutation_attempt_count`` and
``consecutive_correct_count`` feed the configurable auto-mark rule.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0082_quiz_question_variants"
down_revision = "0081_review_unit_lapse_recovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "palace_quiz_questions",
        sa.Column("needs_mutation", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column(
            "active_variant_id",
            sa.String(length=32),
            nullable=False,
            server_default="original",
        ),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column("variant_history_json", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column(
            "mutation_attempt_count", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column(
            "consecutive_correct_count", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column("last_answer_duration_ms", sa.Integer(), nullable=True),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column("variant_activated_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "palace_quiz_questions",
        sa.Column("mutation_marked_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "quiz_attempt_events",
        sa.Column("question_version_id", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table("quiz_attempt_events") as batch:
        batch.drop_column("question_version_id")
    with op.batch_alter_table("palace_quiz_questions") as batch:
        batch.drop_column("mutation_marked_at")
        batch.drop_column("variant_activated_at")
        batch.drop_column("last_answer_duration_ms")
        batch.drop_column("consecutive_correct_count")
        batch.drop_column("mutation_attempt_count")
        batch.drop_column("variant_history_json")
        batch.drop_column("active_variant_id")
        batch.drop_column("needs_mutation")
