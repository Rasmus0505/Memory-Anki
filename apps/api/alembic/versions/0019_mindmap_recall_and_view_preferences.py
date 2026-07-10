"""add mindmap recall events and view preferences

Revision ID: 0019_mindmap_recall_and_view_preferences
Revises: 0018_english_reading_vocabulary_notes
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_mindmap_recall_and_view_preferences"
down_revision = "0018_english_reading_vocabulary_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mindmap_recall_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("study_session_id", sa.String(length=64), nullable=False),
        sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_uid", sa.String(length=128), nullable=False),
        sa.Column("source_scene", sa.String(length=40), nullable=False, server_default="formal_review"),
        sa.Column("recall_round", sa.String(length=20), nullable=False, server_default="first"),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("supersedes_event_id", sa.String(length=64), sa.ForeignKey("mindmap_recall_events.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("rating IN (1, 3, 5)", name="ck_mindmap_recall_events_rating"),
        sa.CheckConstraint("recall_round IN ('first', 'weak_retry')", name="ck_mindmap_recall_events_round"),
    )
    op.create_index("ix_mindmap_recall_events_palace_node", "mindmap_recall_events", ["palace_id", "node_uid", "occurred_at"])
    op.create_index("ix_mindmap_recall_events_session", "mindmap_recall_events", ["study_session_id", "occurred_at"])
    op.create_table(
        "mindmap_node_labels",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("node_uid", sa.String(length=128), nullable=False),
        sa.Column("label", sa.String(length=20), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("palace_id", "node_uid", name="uq_mindmap_node_labels_palace_node"),
        sa.CheckConstraint("label IN ('weak', 'mastered')", name="ck_mindmap_node_labels_label"),
    )
    op.create_index("ix_mindmap_node_labels_palace_label", "mindmap_node_labels", ["palace_id", "label"])
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


def downgrade() -> None:
    op.drop_table("mindmap_view_preferences")
    op.drop_index("ix_mindmap_node_labels_palace_label", table_name="mindmap_node_labels")
    op.drop_table("mindmap_node_labels")
    op.drop_index("ix_mindmap_recall_events_session", table_name="mindmap_recall_events")
    op.drop_index("ix_mindmap_recall_events_palace_node", table_name="mindmap_recall_events")
    op.drop_table("mindmap_recall_events")
