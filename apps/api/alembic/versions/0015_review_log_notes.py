"""add note column to review_logs

Revision ID: 0015_review_log_notes
Revises: 0014_palace_templates
"""

from __future__ import annotations

from alembic import op

revision = "0015_review_log_notes"
down_revision = "0014_palace_templates"
branch_labels = None
depends_on = None


def _table_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    rows = bind.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row[1]) for row in rows}


def upgrade() -> None:
    bind = op.get_bind()
    if "note" not in _table_columns("review_logs"):
        bind.exec_driver_sql(
            "ALTER TABLE review_logs ADD COLUMN note TEXT NOT NULL DEFAULT ''"
        )


def downgrade() -> None:
    return
