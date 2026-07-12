from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ._base import Base


class BatchGenerationWorkspace(Base):
    __tablename__ = "batch_generation_workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    operation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    settings_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    estimated_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actual_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actual_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class BatchGenerationAsset(Base):
    __tablename__ = "batch_generation_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("batch_generation_workspaces.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(24), nullable=False)
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(500), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    scanned_page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bookmarks_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    sample_text_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    analysis_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class BatchGenerationBook(Base):
    __tablename__ = "batch_generation_books"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("batch_generation_workspaces.id", ondelete="CASCADE"), index=True
    )
    textbook_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("batch_generation_assets.id", ondelete="SET NULL")
    )
    quiz_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("batch_generation_assets.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("subjects.id", ondelete="SET NULL"))
    default_output_mode: Mapped[str] = mapped_column(String(24), nullable=False, default="both")
    gate_status: Mapped[str] = mapped_column(String(32), nullable=False, default="outline_review")
    representative_section_id: Mapped[str | None] = mapped_column(String(36))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class BatchGenerationSection(Base):
    __tablename__ = "batch_generation_sections"
    __table_args__ = (UniqueConstraint("book_id", "sort_order", name="uq_batch_section_order"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    book_id: Mapped[str] = mapped_column(
        ForeignKey("batch_generation_books.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("batch_generation_sections.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    start_page: Mapped[int] = mapped_column(Integer, nullable=False)
    end_page: Mapped[int] = mapped_column(Integer, nullable=False)
    output_mode: Mapped[str] = mapped_column(String(24), nullable=False, default="both")
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="waiting_confirmation", index=True
    )
    operation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    existing_chapter_id: Mapped[int | None] = mapped_column(
        ForeignKey("chapters.id", ondelete="SET NULL")
    )
    existing_palace_id: Mapped[int | None] = mapped_column(
        ForeignKey("palaces.id", ondelete="SET NULL")
    )
    match_confidence: Mapped[float | None] = mapped_column(Float)
    excluded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class BatchGenerationStep(Base):
    __tablename__ = "batch_generation_steps"
    __table_args__ = (UniqueConstraint("section_id", "kind", name="uq_batch_section_step"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    section_id: Mapped[str] = mapped_column(
        ForeignKey("batch_generation_sections.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    operation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    user_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    input_snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    output_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    usage_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    error_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class BatchGenerationDraft(Base):
    __tablename__ = "batch_generation_drafts"
    __table_args__ = (UniqueConstraint("section_id", "kind", name="uq_batch_section_draft"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    section_id: Mapped[str] = mapped_column(
        ForeignKey("batch_generation_sections.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    content_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    quality_score: Mapped[float | None] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class BatchGenerationQualityIssue(Base):
    __tablename__ = "batch_generation_quality_issues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    section_id: Mapped[str] = mapped_column(
        ForeignKey("batch_generation_sections.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    details_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class BatchGenerationPublishPlan(Base):
    __tablename__ = "batch_generation_publish_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("batch_generation_workspaces.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    actions_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    conflicts_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
