"""remove palace focus practice

Revision ID: 0028_remove_focus_practice
Revises: 0027_mindmap_recall_evidence
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# memory-anki: allow-destructive-migration — the feature and its historical data are intentionally retired.

revision = "0028_remove_focus_practice"
down_revision = "0027_mindmap_recall_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM session_progress WHERE session_kind = 'focus_practice'")
    op.execute("DROP INDEX IF EXISTS ix_session_progress_focus_practice")
    with op.batch_alter_table("palaces") as batch_op:
        batch_op.drop_column("focus_node_uids_json")


def downgrade() -> None:
    with op.batch_alter_table("palaces") as batch_op:
        batch_op.add_column(
            sa.Column("focus_node_uids_json", sa.Text(), nullable=False, server_default="[]")
        )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_session_progress_focus_practice "
        "ON session_progress (session_kind, palace_id) "
        "WHERE session_kind = 'focus_practice' AND palace_id IS NOT NULL"
    )
