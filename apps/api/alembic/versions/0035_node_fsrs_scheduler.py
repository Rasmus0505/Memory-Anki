"""add node-level FSRS scheduler state and rating operation snapshots

Revision ID: 0035_node_fsrs_scheduler
Revises: 0034_palace_subject_ownership
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_node_fsrs_scheduler"
down_revision = "0034_palace_subject_ownership"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mindmap_recall_events", sa.Column("rating_scope", sa.String(16), nullable=False, server_default="single"))
    op.add_column("mindmap_recall_events", sa.Column("evidence_origin", sa.String(24), nullable=False, server_default="direct"))
    op.create_table(
        "review_node_states",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("palace_id", sa.Integer(), nullable=False),
        sa.Column("node_uid", sa.String(128), nullable=False),
        sa.Column("state", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("step", sa.Integer(), nullable=True),
        sa.Column("stability", sa.Float(), nullable=True),
        sa.Column("difficulty", sa.Float(), nullable=True),
        sa.Column("due_at", sa.DateTime(), nullable=False),
        sa.Column("last_review_at", sa.DateTime(), nullable=True),
        sa.Column("desired_retention", sa.Float(), nullable=False, server_default="0.9"),
        sa.Column("maximum_interval", sa.Integer(), nullable=False, server_default="180"),
        sa.Column("content_fingerprint", sa.String(64), nullable=False, server_default=""),
        sa.Column("state_source", sa.String(24), nullable=False, server_default="new"),
        sa.Column("scheduler_version", sa.String(32), nullable=False, server_default="fsrs-6.3.1"),
        sa.Column("parameter_version", sa.String(32), nullable=False, server_default="default"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["palace_id"], ["palaces.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("palace_id", "node_uid", name="uq_review_node_states_palace_node"),
    )
    op.create_index("ix_review_node_states_due", "review_node_states", ["due_at", "palace_id"])
    op.create_index("ix_review_node_states_palace_due", "review_node_states", ["palace_id", "due_at"])
    op.create_table(
        "review_rating_operations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("study_session_id", sa.String(64), nullable=False),
        sa.Column("palace_id", sa.Integer(), nullable=False),
        sa.Column("root_node_uid", sa.String(128), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("rating_scope", sa.String(16), nullable=False, server_default="single"),
        sa.Column("affected_node_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("undone_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["palace_id"], ["palaces.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_review_rating_operations_session_created", "review_rating_operations", ["study_session_id", "created_at"])
    op.create_index("ix_review_rating_operations_palace_created", "review_rating_operations", ["palace_id", "created_at"])
    op.create_table(
        "review_rating_operation_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("operation_id", sa.String(64), nullable=False),
        sa.Column("palace_id", sa.Integer(), nullable=False),
        sa.Column("node_uid", sa.String(128), nullable=False),
        sa.Column("event_id", sa.String(64), nullable=False),
        sa.Column("before_state_json", sa.Text(), nullable=True),
        sa.Column("after_state_json", sa.Text(), nullable=False),
        sa.Column("before_rating", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["operation_id"], ["review_rating_operations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["palace_id"], ["palaces.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("operation_id", "node_uid", name="uq_review_rating_operation_items_node"),
    )
    op.create_index("ix_review_rating_operation_items_node", "review_rating_operation_items", ["palace_id", "node_uid", "created_at"])


def downgrade() -> None:
    op.drop_column("mindmap_recall_events", "evidence_origin")
    op.drop_column("mindmap_recall_events", "rating_scope")
    op.drop_index("ix_review_rating_operation_items_node", table_name="review_rating_operation_items")
    op.drop_table("review_rating_operation_items")
    op.drop_index("ix_review_rating_operations_palace_created", table_name="review_rating_operations")
    op.drop_index("ix_review_rating_operations_session_created", table_name="review_rating_operations")
    op.drop_table("review_rating_operations")
    op.drop_index("ix_review_node_states_palace_due", table_name="review_node_states")
    op.drop_index("ix_review_node_states_due", table_name="review_node_states")
    op.drop_table("review_node_states")
