"""Add persisted AI learning runs.

Revision ID: 0026_ai_learning_runs
Revises: 0025_batch_generation_workspace
"""

import sqlalchemy as sa
from alembic import op

revision = "0026_ai_learning_runs"
down_revision = "0025_batch_generation_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_learning_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("thread_id", sa.String(36), nullable=False),
        sa.Column("parent_run_id", sa.String(36)),
        sa.Column("retry_of_run_id", sa.String(36)),
        sa.Column("owner_id", sa.String(120), nullable=False),
        sa.Column("operation_id", sa.String(36), nullable=False, unique=True),
        sa.Column("scenario_key", sa.String(80), nullable=False),
        sa.Column("entrypoint_key", sa.String(120), nullable=False),
        sa.Column("review_session_id", sa.Integer()),
        sa.Column("palace_id", sa.Integer()),
        sa.Column("task_key", sa.String(40), nullable=False),
        sa.Column("output_type", sa.String(40), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("user_prompt", sa.Text(), nullable=False),
        sa.Column("prompt_snapshot", sa.Text(), nullable=False),
        sa.Column("context_json", sa.Text(), nullable=False),
        sa.Column("context_selections_json", sa.Text(), nullable=False),
        sa.Column("request_json", sa.Text(), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("model_meta_json", sa.Text(), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=False),
        sa.Column("error_text", sa.Text(), nullable=False),
        sa.Column("feedback", sa.String(24), nullable=False),
        sa.Column("application_status", sa.String(24), nullable=False),
        sa.Column("application_result_json", sa.Text(), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("deleted_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime()),
    )
    op.create_index(
        "ix_ai_learning_runs_thread_created", "ai_learning_runs", ["thread_id", "created_at"]
    )
    op.create_index(
        "ix_ai_learning_runs_review_session",
        "ai_learning_runs",
        ["review_session_id", "created_at"],
    )
    op.create_index("ix_ai_learning_runs_palace", "ai_learning_runs", ["palace_id", "created_at"])


def downgrade() -> None:
    op.drop_table("ai_learning_runs")
