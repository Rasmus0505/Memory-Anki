"""add English reading vocabulary notes

Revision ID: 0018_english_reading_vocabulary_notes
Revises: 0017_soft_delete_palaces_and_quiz_questions
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_english_reading_vocabulary_notes"
down_revision = "0017_soft_delete_palaces_and_quiz_questions"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _index_exists(index_name: str) -> bool:
    bind = op.get_bind()
    row = bind.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
        (index_name,),
    ).fetchone()
    return row is not None


def _create_index_once(index_name: str, table_name: str, columns: list[str]) -> None:
    if _table_exists(table_name) and not _index_exists(index_name):
        op.create_index(index_name, table_name, columns)


def _drop_index_once(index_name: str, table_name: str) -> None:
    if _index_exists(index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    if not _table_exists("english_reading_vocabulary_notes"):
        op.create_table(
            "english_reading_vocabulary_notes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("normalized_surface", sa.String(length=320), nullable=False, unique=True),
            sa.Column("word", sa.String(length=240), nullable=False, server_default=""),
            sa.Column("lemma", sa.String(length=240), nullable=False, server_default=""),
            sa.Column("cefr", sa.String(length=8), nullable=False, server_default=""),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("definition_zh", sa.Text(), nullable=False, server_default=""),
            sa.Column("context", sa.Text(), nullable=False, server_default=""),
            sa.Column("material_id", sa.Integer(), nullable=True),
            sa.Column("version_id", sa.Integer(), nullable=True),
            sa.Column("span_annotation_id", sa.String(length=80), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("review_number", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("review_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("incorrect_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("next_due_date", sa.Date(), nullable=True),
            sa.Column("next_due_at", sa.DateTime(), nullable=True),
            sa.Column("interval_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("review_type", sa.String(length=20), nullable=False, server_default="standard"),
            sa.Column(
                "algorithm_used",
                sa.String(length=30),
                nullable=False,
                server_default="ebbinghaus",
            ),
            sa.Column("anchor_date", sa.Date(), nullable=True),
            sa.Column("last_reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(
                ["material_id"],
                ["english_reading_materials.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["version_id"],
                ["english_reading_versions.id"],
                ondelete="SET NULL",
            ),
        )
    _create_index_once(
        "ix_english_reading_vocabulary_notes_due",
        "english_reading_vocabulary_notes",
        ["status", "next_due_date", "next_due_at"],
    )
    _create_index_once(
        "ix_english_reading_vocabulary_notes_updated",
        "english_reading_vocabulary_notes",
        ["updated_at"],
    )
    _create_index_once(
        "ix_english_reading_vocabulary_notes_material",
        "english_reading_vocabulary_notes",
        ["material_id", "version_id"],
    )


def downgrade() -> None:
    _drop_index_once("ix_english_reading_vocabulary_notes_material", "english_reading_vocabulary_notes")
    _drop_index_once("ix_english_reading_vocabulary_notes_updated", "english_reading_vocabulary_notes")
    _drop_index_once("ix_english_reading_vocabulary_notes_due", "english_reading_vocabulary_notes")
    if _table_exists("english_reading_vocabulary_notes"):
        op.drop_table("english_reading_vocabulary_notes")
