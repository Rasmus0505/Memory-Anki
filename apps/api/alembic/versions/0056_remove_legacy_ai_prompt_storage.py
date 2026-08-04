"""Remove retired complete-prompt versioning and evaluation storage.

Revision ID: 0056_remove_legacy_ai_prompt_storage
Revises: 0055_remove_migrated_review_log_duplicates
"""

from __future__ import annotations

from alembic import op

# memory-anki: allow-destructive-migration - complete prompt versioning and
# evaluation were replaced by modular prompt blocks and scene versions.

revision = "0056_remove_legacy_ai_prompt_storage"
down_revision = "0055_remove_migrated_review_log_duplicates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_ai_eval_runs_prompt_created", table_name="ai_eval_runs")
    op.drop_table("ai_eval_runs")
    op.drop_index("ix_ai_prompt_versions_key_status", table_name="ai_prompt_versions")
    op.drop_index("ix_ai_prompt_versions_key_created", table_name="ai_prompt_versions")
    op.drop_table("ai_prompt_versions")
    with op.batch_alter_table("external_ai_call_logs") as batch:
        batch.drop_column("prompt_version_id")


def downgrade() -> None:
    raise RuntimeError("0056 permanently removes retired prompt versioning storage")
