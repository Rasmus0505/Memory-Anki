"""Add quiz lifecycle, evidence, and unified attempt events."""

from alembic import op
import sqlalchemy as sa

revision = "0024_quiz_learning_loop"
down_revision = "0023_quiz_generation_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("palace_quiz_questions") as batch:
        batch.add_column(
            sa.Column("lifecycle_status", sa.String(24), nullable=False, server_default="published")
        )
        batch.add_column(sa.Column("evidence_json", sa.Text(), nullable=False, server_default="[]"))
        batch.add_column(
            sa.Column("knowledge_tags_json", sa.Text(), nullable=False, server_default="[]")
        )
        batch.add_column(
            sa.Column("cognitive_level", sa.String(32), nullable=False, server_default="recall")
        )
        batch.add_column(sa.Column("difficulty", sa.Integer(), nullable=False, server_default="3"))
        batch.add_column(sa.Column("quality_score", sa.Float(), nullable=True))
        batch.add_column(
            sa.Column("quality_review_json", sa.Text(), nullable=False, server_default="{}")
        )
        batch.add_column(sa.Column("generation_job_id", sa.String(36), nullable=True))
        batch.add_column(
            sa.Column("version_number", sa.Integer(), nullable=False, server_default="1")
        )
        batch.create_index(
            "ix_palace_quiz_questions_lifecycle_updated", ["lifecycle_status", "updated_at"]
        )
    op.create_table(
        "quiz_attempt_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "question_id",
            sa.Integer(),
            sa.ForeignKey("palace_quiz_questions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "palace_id",
            sa.Integer(),
            sa.ForeignKey("palaces.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "chapter_id",
            sa.Integer(),
            sa.ForeignKey("chapters.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scene", sa.String(40), nullable=False, server_default="quiz"),
        sa.Column("question_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("answer_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("hint_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("confidence", sa.Integer(), nullable=True),
        sa.Column("ai_score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_quiz_attempt_events_question_created",
        "quiz_attempt_events",
        ["question_id", "created_at"],
    )
    op.create_index(
        "ix_quiz_attempt_events_scene_created", "quiz_attempt_events", ["scene", "created_at"]
    )
    op.create_index(
        "ix_quiz_attempt_events_palace_created", "quiz_attempt_events", ["palace_id", "created_at"]
    )


# memory-anki: allow-destructive-migration - downgrade only removes fields introduced here.
def downgrade() -> None:
    op.drop_index("ix_quiz_attempt_events_palace_created", table_name="quiz_attempt_events")
    op.drop_index("ix_quiz_attempt_events_scene_created", table_name="quiz_attempt_events")
    op.drop_index("ix_quiz_attempt_events_question_created", table_name="quiz_attempt_events")
    op.drop_table("quiz_attempt_events")
    with op.batch_alter_table("palace_quiz_questions") as batch:
        batch.drop_index("ix_palace_quiz_questions_lifecycle_updated")
        for name in (
            "version_number",
            "generation_job_id",
            "quality_review_json",
            "quality_score",
            "difficulty",
            "cognitive_level",
            "knowledge_tags_json",
            "evidence_json",
            "lifecycle_status",
        ):
            batch.drop_column(name)
