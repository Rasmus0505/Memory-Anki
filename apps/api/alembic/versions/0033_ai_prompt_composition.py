"""add modular AI prompt composition tables

Revision ID: 0033_ai_prompt_composition
Revises: 0032_review_stage_adjustments
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0033_ai_prompt_composition"
down_revision = "0032_review_stage_adjustments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_prompt_blocks",
        sa.Column("key", sa.String(length=120), primary_key=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("layer", sa.String(length=40), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("applicable_scenes_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("placeholders_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("active_version_id", sa.String(length=64), nullable=True),
        sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "ai_prompt_block_versions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("block_key", sa.String(length=120), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="custom"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("activated_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_ai_prompt_block_versions_key_created",
        "ai_prompt_block_versions",
        ["block_key", "created_at"],
    )
    op.create_index(
        "ix_ai_prompt_block_versions_key_status",
        "ai_prompt_block_versions",
        ["block_key", "status"],
    )
    op.create_table(
        "ai_prompt_scene_defaults",
        sa.Column("scene_key", sa.String(length=120), primary_key=True),
        sa.Column("prompt_key", sa.String(length=120), nullable=False),
        sa.Column("active_version_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "ai_prompt_scene_versions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("scene_key", sa.String(length=120), nullable=False),
        sa.Column("block_keys_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("scene_instruction", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="builtin"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("activated_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_ai_prompt_scene_versions_scene_created",
        "ai_prompt_scene_versions",
        ["scene_key", "created_at"],
    )
    op.create_index(
        "ix_ai_prompt_scene_versions_scene_status",
        "ai_prompt_scene_versions",
        ["scene_key", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_prompt_scene_versions_scene_status", table_name="ai_prompt_scene_versions")
    op.drop_index("ix_ai_prompt_scene_versions_scene_created", table_name="ai_prompt_scene_versions")
    op.drop_table("ai_prompt_scene_versions")
    op.drop_table("ai_prompt_scene_defaults")
    op.drop_index("ix_ai_prompt_block_versions_key_status", table_name="ai_prompt_block_versions")
    op.drop_index("ix_ai_prompt_block_versions_key_created", table_name="ai_prompt_block_versions")
    op.drop_table("ai_prompt_block_versions")
    op.drop_table("ai_prompt_blocks")
