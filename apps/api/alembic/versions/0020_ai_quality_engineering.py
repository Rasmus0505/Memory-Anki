"""add AI quality engineering fields

Revision ID: 0020_ai_quality_engineering
Revises: 0019_mindmap_recall_and_view_preferences
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020_ai_quality_engineering"
down_revision = "0019_mindmap_recall_and_view_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_prompt_versions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("prompt_key", sa.String(120), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="candidate"),
        sa.Column("source", sa.String(24), nullable=False, server_default="custom"),
        sa.Column("eval_summary_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("activated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_ai_prompt_versions_key_created", "ai_prompt_versions", ["prompt_key", "created_at"])
    op.create_index("ix_ai_prompt_versions_key_status", "ai_prompt_versions", ["prompt_key", "status"])
    op.create_table(
        "ai_eval_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("prompt_key", sa.String(120), nullable=False),
        sa.Column("candidate_version_id", sa.String(64), nullable=False),
        sa.Column("baseline_version_id", sa.String(64), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="completed"),
        sa.Column("case_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("schema_success_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("assertion_success_rate", sa.Float(), nullable=False, server_default="0"),
        sa.Column("baseline_assertion_success_rate", sa.Float(), nullable=True),
        sa.Column("critical_passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("gate_passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("results_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_ai_eval_runs_prompt_created", "ai_eval_runs", ["prompt_key", "created_at"])
    with op.batch_alter_table("ai_model_catalog") as batch:
        batch.add_column(sa.Column("structured_output_mode", sa.String(24), nullable=False, server_default="json_object"))
        batch.add_column(sa.Column("input_price_per_million", sa.Float(), nullable=True))
        batch.add_column(sa.Column("output_price_per_million", sa.Float(), nullable=True))
        batch.add_column(sa.Column("cached_input_price_per_million", sa.Float(), nullable=True))
    with op.batch_alter_table("external_ai_call_logs") as batch:
        batch.alter_column("request_id", existing_type=sa.String(64), type_=sa.String(128), existing_nullable=False)
        batch.add_column(sa.Column("scene", sa.String(120), nullable=False, server_default=""))
        batch.add_column(sa.Column("prompt_version_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("structured_output_mode", sa.String(24), nullable=False, server_default=""))
        batch.add_column(sa.Column("finish_reason", sa.String(40), nullable=False, server_default=""))
        batch.add_column(sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("cached_input_tokens", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("estimated_cost", sa.Float(), nullable=True))
        batch.add_column(sa.Column("first_token_ms", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("duration_ms", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("error_kind", sa.String(40), nullable=False, server_default=""))
        batch.add_column(sa.Column("repaired_from_log_id", sa.String(64), nullable=True))
        batch.create_index("ix_external_ai_call_logs_scene_created", ["scene", "created_at"])


# memory-anki: allow-destructive-migration - downgrade only removes fields introduced by this revision.
def downgrade() -> None:
    with op.batch_alter_table("external_ai_call_logs") as batch:
        batch.drop_index("ix_external_ai_call_logs_scene_created")
        for column in (
            "repaired_from_log_id", "error_kind", "attempt_count", "duration_ms", "first_token_ms",
            "estimated_cost", "cached_input_tokens", "output_tokens", "input_tokens", "finish_reason",
            "structured_output_mode", "prompt_version_id", "scene",
        ):
            batch.drop_column(column)
        batch.alter_column("request_id", existing_type=sa.String(128), type_=sa.String(64), existing_nullable=False)
    with op.batch_alter_table("ai_model_catalog") as batch:
        batch.drop_column("cached_input_price_per_million")
        batch.drop_column("output_price_per_million")
        batch.drop_column("input_price_per_million")
        batch.drop_column("structured_output_mode")
    op.drop_index("ix_ai_eval_runs_prompt_created", table_name="ai_eval_runs")
    op.drop_table("ai_eval_runs")
    op.drop_index("ix_ai_prompt_versions_key_status", table_name="ai_prompt_versions")
    op.drop_index("ix_ai_prompt_versions_key_created", table_name="ai_prompt_versions")
    op.drop_table("ai_prompt_versions")
