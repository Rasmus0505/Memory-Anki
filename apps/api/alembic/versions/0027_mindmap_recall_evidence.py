"""extend mindmap recall evidence

Revision ID: 0027_mindmap_recall_evidence
Revises: 0026_ai_learning_runs
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027_mindmap_recall_evidence"
down_revision = "0026_ai_learning_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mindmap_recall_events", sa.Column("rating_source", sa.String(length=20), nullable=False, server_default="manual"))
    op.add_column("mindmap_recall_events", sa.Column("inference_confidence", sa.Float(), nullable=True))
    op.add_column("mindmap_recall_events", sa.Column("response_ms", sa.Integer(), nullable=True))
    op.add_column("mindmap_recall_events", sa.Column("hint_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("mindmap_recall_events", sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("mindmap_recall_events", sa.Column("operation_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("mindmap_recall_events", "operation_id")
    op.drop_column("mindmap_recall_events", "retry_count")
    op.drop_column("mindmap_recall_events", "hint_count")
    op.drop_column("mindmap_recall_events", "response_ms")
    op.drop_column("mindmap_recall_events", "inference_confidence")
    op.drop_column("mindmap_recall_events", "rating_source")