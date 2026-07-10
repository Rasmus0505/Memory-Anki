"""remove mindmap view preferences

Revision ID: 0021_remove_mindmap_view_preferences
Revises: 0020_ai_quality_engineering
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_remove_mindmap_view_preferences"
down_revision = "0020_ai_quality_engineering"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("mindmap_view_preferences")


def downgrade() -> None:
    op.create_table(
        "mindmap_view_preferences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("entity_type", sa.String(length=20), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("scene", sa.String(length=20), nullable=False),
        sa.Column("collapsed_node_uids_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entity_type", "entity_id", "scene", name="uq_mindmap_view_preferences_entity_scene"),
        sa.CheckConstraint("entity_type IN ('palace', 'subject')", name="ck_mindmap_view_preferences_entity_type"),
        sa.CheckConstraint("scene IN ('build', 'learn')", name="ck_mindmap_view_preferences_scene"),
    )