"""english reading gap-driven article loop

Revision ID: 0044_english_reading_gap_loop
Revises: 0043_palace_review_waves
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0044_english_reading_gap_loop"
down_revision = "0043_palace_review_waves"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "english_reading_articles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(length=240), nullable=False, server_default=""),
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="source"),
        sa.Column("source_type", sa.String(length=20), nullable=False, server_default="paste"),
        sa.Column("original_filename", sa.String(length=320), nullable=False, server_default=""),
        sa.Column("original_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("depth", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parent_article_id", sa.Integer(), sa.ForeignKey("english_reading_articles.id", ondelete="CASCADE"), nullable=True),
        sa.Column("generation_config_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_english_reading_articles_parent", "english_reading_articles", ["parent_article_id", "created_at"])
    op.create_index("ix_english_reading_articles_updated", "english_reading_articles", ["updated_at"])
    op.create_table(
        "english_reading_targets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("article_id", sa.Integer(), sa.ForeignKey("english_reading_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False, server_default=""),
        sa.Column("quote_checksum", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("normalized_value", sa.String(length=320), nullable=False, server_default=""),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("article_id", "target_type", "start_offset", "end_offset", name="uq_english_reading_target_anchor"),
    )
    op.create_index("ix_english_reading_targets_article", "english_reading_targets", ["article_id", "start_offset"])
    op.create_table(
        "english_reading_explanations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("target_id", sa.Integer(), sa.ForeignKey("english_reading_targets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation_id", sa.String(length=80), nullable=False, unique=True),
        sa.Column("explanation_type", sa.String(length=24), nullable=False),
        sa.Column("cefr", sa.String(length=8), nullable=False, server_default="B1"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="completed"),
        sa.Column("result_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("ai_runtime_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_english_reading_explanations_target", "english_reading_explanations", ["target_id", "created_at"])
    op.create_table(
        "english_reading_generation_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_article_id", sa.Integer(), sa.ForeignKey("english_reading_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("result_article_id", sa.Integer(), sa.ForeignKey("english_reading_articles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("operation_id", sa.String(length=80), nullable=False, unique=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="running"),
        sa.Column("target_ids_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("config_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("coverage_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("ai_runtime_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_english_reading_generation_owner", "english_reading_generation_runs", ["owner_article_id", "created_at"])
    op.create_table(
        "english_reading_article_target_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("article_id", sa.Integer(), sa.ForeignKey("english_reading_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_id", sa.Integer(), sa.ForeignKey("english_reading_targets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("article_id", "target_id", name="uq_english_reading_article_target_link"),
    )
    op.create_index("ix_english_reading_article_target_links_target", "english_reading_article_target_links", ["target_id"])
    for table in (
        "english_reading_vocabulary_notes",
        "english_reading_sessions",
        "english_reading_versions",
        "english_reading_materials",
        "english_reading_lexicon_cache",
        "english_reading_dictionary_cache",
    ):
        op.execute(sa.text(f"DELETE FROM {table}"))


def downgrade() -> None:
    op.drop_index("ix_english_reading_article_target_links_target", table_name="english_reading_article_target_links")
    op.drop_table("english_reading_article_target_links")
    op.drop_index("ix_english_reading_generation_owner", table_name="english_reading_generation_runs")
    op.drop_table("english_reading_generation_runs")
    op.drop_index("ix_english_reading_explanations_target", table_name="english_reading_explanations")
    op.drop_table("english_reading_explanations")
    op.drop_index("ix_english_reading_targets_article", table_name="english_reading_targets")
    op.drop_table("english_reading_targets")
    op.drop_index("ix_english_reading_articles_updated", table_name="english_reading_articles")
    op.drop_index("ix_english_reading_articles_parent", table_name="english_reading_articles")
    op.drop_table("english_reading_articles")
