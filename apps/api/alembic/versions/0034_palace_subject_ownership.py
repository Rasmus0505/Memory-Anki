"""add explicit palace subject ownership

Revision ID: 0034_palace_subject_ownership
Revises: 0033_ai_prompt_composition
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034_palace_subject_ownership"
down_revision = "0033_ai_prompt_composition"
branch_labels = None
depends_on = None

UNCATEGORIZED_NAME = "未分类"


def upgrade() -> None:
    op.add_column(
        "palaces",
        sa.Column("binding_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "palace_subjects",
        sa.Column("palace_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["palace_id"], ["palaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_id"], ["subjects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("palace_id", "subject_id"),
    )
    op.create_index(
        "ix_palace_subjects_subject_palace",
        "palace_subjects",
        ["subject_id", "palace_id"],
    )

    bind = op.get_bind()
    bind.execute(sa.text(
        """
        INSERT OR IGNORE INTO palace_subjects (palace_id, subject_id)
        SELECT DISTINCT cp.palace_id, c.subject_id
        FROM chapter_palaces cp
        JOIN chapters c ON c.id = cp.chapter_id
        WHERE COALESCE(cp.is_explicit, 1) = 1
        """
    ))
    bind.execute(sa.text(
        """
        INSERT OR IGNORE INTO palace_subjects (palace_id, subject_id)
        SELECT p.id, c.subject_id
        FROM palaces p
        JOIN chapters c ON c.id = p.primary_chapter_id
        WHERE p.primary_chapter_id IS NOT NULL
        """
    ))
    bind.execute(sa.text(
        """
        INSERT OR IGNORE INTO palace_subjects (palace_id, subject_id)
        SELECT DISTINCT cp.palace_id, c.subject_id
        FROM chapter_palaces cp
        JOIN chapters c ON c.id = cp.chapter_id
        WHERE NOT EXISTS (
            SELECT 1 FROM palace_subjects ps WHERE ps.palace_id = cp.palace_id
        )
        """
    ))

    missing_count = bind.execute(sa.text(
        """
        SELECT COUNT(*) FROM palaces p
        WHERE NOT EXISTS (SELECT 1 FROM palace_subjects ps WHERE ps.palace_id = p.id)
        """
    )).scalar_one()
    if missing_count:
        subject_id = bind.execute(
            sa.text("SELECT id FROM subjects WHERE name = :name ORDER BY id LIMIT 1"),
            {"name": UNCATEGORIZED_NAME},
        ).scalar()
        if subject_id is None:
            bind.execute(
                sa.text(
                    "INSERT INTO subjects (name, color, sort_order, editor_doc, editor_config, editor_local_config) "
                    "VALUES (:name, '#94a3b8', 999999, '', '', '')"
                ),
                {"name": UNCATEGORIZED_NAME},
            )
            subject_id = bind.execute(
                sa.text("SELECT id FROM subjects WHERE name = :name ORDER BY id LIMIT 1"),
                {"name": UNCATEGORIZED_NAME},
            ).scalar_one()
        bind.execute(
            sa.text(
                """
                INSERT OR IGNORE INTO palace_subjects (palace_id, subject_id)
                SELECT p.id, :subject_id FROM palaces p
                WHERE NOT EXISTS (SELECT 1 FROM palace_subjects ps WHERE ps.palace_id = p.id)
                """
            ),
            {"subject_id": subject_id},
        )


def downgrade() -> None:
    op.drop_index("ix_palace_subjects_subject_palace", table_name="palace_subjects")
    op.drop_table("palace_subjects")
    op.drop_column("palaces", "binding_revision")
