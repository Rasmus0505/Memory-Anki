"""add persistent pdf document library

Revision ID: 0030_pdf_document_library
Revises: 0029_unify_learning_groups
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030_pdf_document_library"
down_revision = "0029_unify_learning_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pdf_documents",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("filename", sa.String(length=300), nullable=False, unique=True),
        sa.Column("original_name", sa.String(length=300), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False, server_default="application/pdf"),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_pdf_documents_created", "pdf_documents", ["created_at", "id"])


def downgrade() -> None:
    op.drop_index("ix_pdf_documents_created", table_name="pdf_documents")
    op.drop_table("pdf_documents")
