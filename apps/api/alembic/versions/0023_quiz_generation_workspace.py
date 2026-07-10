"""Add persistent quiz generation workspace and PDF library."""

from alembic import op
import sqlalchemy as sa

revision = "0023_quiz_generation_workspace"
down_revision = "0022_preserve_retired_mindmap_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quiz_pdf_assets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("original_name", sa.String(300), nullable=False),
        sa.Column("relative_path", sa.String(500), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_quiz_pdf_assets_archived_updated", "quiz_pdf_assets", ["archived", "updated_at"])
    op.create_index("ix_quiz_pdf_assets_content_hash", "quiz_pdf_assets", ["content_hash"])
    op.create_table(
        "quiz_generation_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("palace_id", sa.Integer(), sa.ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("selected_chapter_id", sa.Integer(), sa.ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("title", sa.String(240), nullable=False, server_default="未命名题库生成"),
        sa.Column("extra_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("options_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("matching_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("preview_json", sa.Text(), nullable=False, server_default=""),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_quiz_generation_jobs_palace_updated", "quiz_generation_jobs", ["palace_id", "updated_at"])
    op.create_index("ix_quiz_generation_jobs_status_updated", "quiz_generation_jobs", ["status", "updated_at"])
    op.create_table(
        "quiz_generation_sources",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("quiz_generation_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("source_type", sa.String(24), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("display_name", sa.String(300), nullable=False, server_default=""),
        sa.Column("relative_path", sa.String(500), nullable=False, server_default=""),
        sa.Column("original_name", sa.String(300), nullable=False, server_default=""),
        sa.Column("mime_type", sa.String(160), nullable=False, server_default=""),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("text_content", sa.Text(), nullable=False, server_default=""),
        sa.Column("pdf_asset_id", sa.Integer(), sa.ForeignKey("quiz_pdf_assets.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("page_numbers_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("config_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("job_id", "sort_order", name="uq_quiz_generation_sources_job_sort"),
    )
    op.create_index("ix_quiz_generation_sources_job_role", "quiz_generation_sources", ["job_id", "role", "sort_order"])
    op.create_index("ix_quiz_generation_sources_pdf_asset", "quiz_generation_sources", ["pdf_asset_id"])


# memory-anki: allow-destructive-migration - downgrade only removes fields introduced by this revision.
def downgrade() -> None:
    op.drop_index("ix_quiz_generation_sources_pdf_asset", table_name="quiz_generation_sources")
    op.drop_index("ix_quiz_generation_sources_job_role", table_name="quiz_generation_sources")
    op.drop_table("quiz_generation_sources")
    op.drop_index("ix_quiz_generation_jobs_status_updated", table_name="quiz_generation_jobs")
    op.drop_index("ix_quiz_generation_jobs_palace_updated", table_name="quiz_generation_jobs")
    op.drop_table("quiz_generation_jobs")
    op.drop_index("ix_quiz_pdf_assets_content_hash", table_name="quiz_pdf_assets")
    op.drop_index("ix_quiz_pdf_assets_archived_updated", table_name="quiz_pdf_assets")
    op.drop_table("quiz_pdf_assets")
