"""add palace quiz OCR source provenance

Revision ID: 0010_palace_quiz_ocr_sources
Revises: 0009_restore_review_schedule_algorithm_used
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_palace_quiz_ocr_sources"
down_revision = "0009_restore_review_schedule_algorithm_used"
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
    if _table_exists("palace_quiz_ocr_sources"):
        return
    op.create_table(
        "palace_quiz_ocr_sources",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "palace_id",
            sa.Integer(),
            sa.ForeignKey("palaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_kind", sa.String(length=40), nullable=False, server_default="ocr"),
        sa.Column("source_set", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("page_key", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("image_path", sa.Text(), nullable=False, server_default=""),
        sa.Column("raw_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("lines_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("source_meta_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("import_batch", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "palace_id",
            "source_set",
            "page_key",
            "import_batch",
            name="uq_palace_quiz_ocr_sources_page_batch",
        ),
    )
    op.create_index(
        "ix_palace_quiz_ocr_sources_palace",
        "palace_quiz_ocr_sources",
        ["palace_id"],
    )
    op.create_index(
        "ix_palace_quiz_ocr_sources_palace_source",
        "palace_quiz_ocr_sources",
        ["palace_id", "source_set", "page_number"],
    )


def downgrade() -> None:
    if not _table_exists("palace_quiz_ocr_sources"):
        return
    op.drop_index("ix_palace_quiz_ocr_sources_palace_source", table_name="palace_quiz_ocr_sources")
    op.drop_index("ix_palace_quiz_ocr_sources_palace", table_name="palace_quiz_ocr_sources")
    op.drop_table("palace_quiz_ocr_sources")
