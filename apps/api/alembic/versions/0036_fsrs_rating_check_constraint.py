"""allow FSRS ratings 1-4 on mindmap_recall_events

Revision ID: 0036_fsrs_rating_check
Revises: 0035_node_fsrs_scheduler

Legacy schema used Anki-style ratings (1/3/5). Node FSRS uses 1-4
(again/hard/good/easy). Without this migration, saving rating 2 or 4
raises CHECK constraint and surfaces as HTTP 500.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036_fsrs_rating_check"
down_revision = "0035_node_fsrs_scheduler"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Map legacy "easy" (5) to FSRS easy (4) before tightening the check.
    op.execute(sa.text("UPDATE mindmap_recall_events SET rating = 4 WHERE rating = 5"))
    with op.batch_alter_table("mindmap_recall_events") as batch:
        batch.drop_constraint("ck_mindmap_recall_events_rating", type_="check")
        batch.create_check_constraint(
            "ck_mindmap_recall_events_rating",
            "rating IN (1, 2, 3, 4)",
        )


def downgrade() -> None:
    op.execute(sa.text("UPDATE mindmap_recall_events SET rating = 5 WHERE rating = 4"))
    op.execute(sa.text("UPDATE mindmap_recall_events SET rating = 3 WHERE rating = 2"))
    with op.batch_alter_table("mindmap_recall_events") as batch:
        batch.drop_constraint("ck_mindmap_recall_events_rating", type_="check")
        batch.create_check_constraint(
            "ck_mindmap_recall_events_rating",
            "rating IN (1, 3, 5)",
        )
