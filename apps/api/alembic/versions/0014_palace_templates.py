"""add palace templates table

Revision ID: 0014_palace_templates
Revises: 0013_prune_legacy_config_keys
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0014_palace_templates"
down_revision = "0013_prune_legacy_config_keys"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def upgrade() -> None:
    if not _table_exists("palace_templates"):
        op.create_table(
            "palace_templates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=200), nullable=False, server_default=""),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("editor_doc", sa.Text(), nullable=False, server_default=""),
            sa.Column("editor_config", sa.Text(), nullable=False, server_default=""),
            sa.Column("source_palace_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    if _table_exists("palace_templates"):
        op.drop_table("palace_templates")
