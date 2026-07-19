"""add English topic pattern (句模) tables with sentence FSRS

Revision ID: 0040_english_topic_patterns
Revises: 0039_unify_fsrs_drop_legacy_schedules
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0040_english_topic_patterns"
down_revision = "0039_unify_fsrs_drop_legacy_schedules"
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
    if not _table_exists("english_topic_patterns"):
        op.create_table(
            "english_topic_patterns",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("title", sa.String(length=240), nullable=False, server_default=""),
            sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
    _create_index_once(
        "ix_english_topic_patterns_status_updated",
        "english_topic_patterns",
        ["status", "updated_at"],
    )
    _create_index_once(
        "ix_english_topic_patterns_updated",
        "english_topic_patterns",
        ["updated_at"],
    )

    if not _table_exists("english_pattern_prompts"):
        op.create_table(
            "english_pattern_prompts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pattern_id", sa.Integer(), nullable=False),
            sa.Column("prompt_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("text_en", sa.Text(), nullable=False, server_default=""),
            sa.Column("text_zh", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(
                ["pattern_id"],
                ["english_topic_patterns.id"],
                ondelete="CASCADE",
            ),
        )
    _create_index_once(
        "ix_english_pattern_prompts_pattern_index",
        "english_pattern_prompts",
        ["pattern_id", "prompt_index"],
    )

    if not _table_exists("english_pattern_sentences"):
        op.create_table(
            "english_pattern_sentences",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pattern_id", sa.Integer(), nullable=False),
            sa.Column("prompt_id", sa.Integer(), nullable=False),
            sa.Column("sentence_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("text_en", sa.Text(), nullable=False, server_default=""),
            sa.Column("text_zh", sa.Text(), nullable=False, server_default=""),
            sa.Column("slots_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("collocations_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("note", sa.Text(), nullable=False, server_default=""),
            sa.Column("source", sa.String(length=32), nullable=False, server_default="manual"),
            sa.Column("source_course_id", sa.Integer(), nullable=True),
            sa.Column("source_sentence_id", sa.Integer(), nullable=True),
            sa.Column("source_material_id", sa.Integer(), nullable=True),
            sa.Column("source_version_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("review_number", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("review_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("correct_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("incorrect_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("next_due_date", sa.Date(), nullable=True),
            sa.Column("next_due_at", sa.DateTime(), nullable=True),
            sa.Column("interval_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("review_type", sa.String(length=20), nullable=False, server_default="fsrs"),
            sa.Column("algorithm_used", sa.String(length=30), nullable=False, server_default="FSRS"),
            sa.Column("anchor_date", sa.Date(), nullable=True),
            sa.Column("last_reviewed_at", sa.DateTime(), nullable=True),
            sa.Column("fsrs_state", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("fsrs_step", sa.Integer(), nullable=True),
            sa.Column("stability", sa.Float(), nullable=True),
            sa.Column("difficulty", sa.Float(), nullable=True),
            sa.Column("due_at", sa.DateTime(), nullable=True),
            sa.Column("last_review_at", sa.DateTime(), nullable=True),
            sa.Column("desired_retention", sa.Float(), nullable=False, server_default="0.9"),
            sa.Column("maximum_interval", sa.Integer(), nullable=False, server_default="180"),
            sa.Column(
                "scheduler_version",
                sa.String(length=32),
                nullable=False,
                server_default="fsrs-6.3.1",
            ),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(
                ["pattern_id"],
                ["english_topic_patterns.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["prompt_id"],
                ["english_pattern_prompts.id"],
                ondelete="CASCADE",
            ),
        )
    _create_index_once(
        "ix_english_pattern_sentences_due",
        "english_pattern_sentences",
        ["status", "due_at", "next_due_at"],
    )
    _create_index_once(
        "ix_english_pattern_sentences_pattern",
        "english_pattern_sentences",
        ["pattern_id", "status"],
    )
    _create_index_once(
        "ix_english_pattern_sentences_prompt",
        "english_pattern_sentences",
        ["prompt_id", "sentence_index"],
    )


def downgrade() -> None:
    _drop_index_once("ix_english_pattern_sentences_prompt", "english_pattern_sentences")
    _drop_index_once("ix_english_pattern_sentences_pattern", "english_pattern_sentences")
    _drop_index_once("ix_english_pattern_sentences_due", "english_pattern_sentences")
    if _table_exists("english_pattern_sentences"):
        op.drop_table("english_pattern_sentences")
    _drop_index_once("ix_english_pattern_prompts_pattern_index", "english_pattern_prompts")
    if _table_exists("english_pattern_prompts"):
        op.drop_table("english_pattern_prompts")
    _drop_index_once("ix_english_topic_patterns_updated", "english_topic_patterns")
    _drop_index_once("ix_english_topic_patterns_status_updated", "english_topic_patterns")
    if _table_exists("english_topic_patterns"):
        op.drop_table("english_topic_patterns")
