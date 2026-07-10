"""Persistent AI quiz generation jobs and reusable PDF assets."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from memory_anki.core.time import utc_now_naive

from ._base import Base


class QuizPdfAsset(Base):
    __tablename__ = "quiz_pdf_assets"
    __table_args__ = (
        Index("ix_quiz_pdf_assets_archived_updated", "archived", "updated_at"),
        Index("ix_quiz_pdf_assets_content_hash", "content_hash"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(500), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utc_now_naive, onupdate=utc_now_naive
    )
    sources: Mapped[list[QuizGenerationSource]] = relationship(
        "QuizGenerationSource", back_populates="pdf_asset"
    )


class QuizGenerationJob(Base):
    __tablename__ = "quiz_generation_jobs"
    __table_args__ = (
        Index("ix_quiz_generation_jobs_palace_updated", "palace_id", "updated_at"),
        Index("ix_quiz_generation_jobs_status_updated", "status", "updated_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    palace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False
    )
    selected_chapter_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    title: Mapped[str] = mapped_column(String(240), nullable=False, default="未命名题库生成")
    extra_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    options_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    matching_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    preview_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utc_now_naive, onupdate=utc_now_naive
    )
    sources: Mapped[list[QuizGenerationSource]] = relationship(
        "QuizGenerationSource",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="QuizGenerationSource.sort_order",
    )


class QuizGenerationSource(Base):
    __tablename__ = "quiz_generation_sources"
    __table_args__ = (
        UniqueConstraint("job_id", "sort_order", name="uq_quiz_generation_sources_job_sort"),
        Index("ix_quiz_generation_sources_job_role", "job_id", "role", "sort_order"),
        Index("ix_quiz_generation_sources_pdf_asset", "pdf_asset_id"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("quiz_generation_jobs.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    source_type: Mapped[str] = mapped_column(String(24), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    display_name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    relative_path: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    original_name: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    mime_type: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    pdf_asset_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("quiz_pdf_assets.id", ondelete="RESTRICT"), nullable=True
    )
    page_numbers_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=utc_now_naive, onupdate=utc_now_naive
    )
    job: Mapped[QuizGenerationJob] = relationship("QuizGenerationJob", back_populates="sources")
    pdf_asset: Mapped[QuizPdfAsset | None] = relationship("QuizPdfAsset", back_populates="sources")


__all__ = ["QuizGenerationJob", "QuizGenerationSource", "QuizPdfAsset"]
