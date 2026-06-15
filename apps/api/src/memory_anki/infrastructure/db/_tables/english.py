"""English course domain ORM tables."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from memory_anki.core.time import utc_now_naive

from ._base import Base


class EnglishCourse(Base):
    __tablename__ = "english_courses"
    __table_args__ = (
        Index("ix_english_courses_created_at", "created_at"),
        Index("ix_english_courses_updated_at", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    original_filename: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    media_filename: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    media_relative_path: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    media_mime_type: Mapped[str] = mapped_column(String(120), nullable=False, default="video/mp4")
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sentence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    sentences: Mapped[list[EnglishSentence]] = relationship(
        "EnglishSentence",
        back_populates="course",
        cascade="all, delete-orphan",
        order_by="EnglishSentence.sentence_index",
    )
    progress: Mapped[EnglishCourseProgress | None] = relationship(
        "EnglishCourseProgress",
        back_populates="course",
        cascade="all, delete-orphan",
        uselist=False,
    )


class EnglishSentence(Base):
    __tablename__ = "english_sentences"
    __table_args__ = (
        Index("ix_english_sentences_course_sentence", "course_id", "sentence_index"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("english_courses.id", ondelete="CASCADE"),
        nullable=False,
    )
    sentence_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    text_zh: Mapped[str] = mapped_column(Text, nullable=False, default="")
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_json: Mapped[str] = mapped_column(Text, default="[]")
    vocabulary_json: Mapped[str] = mapped_column(Text, default="{}")

    course: Mapped[EnglishCourse] = relationship("EnglishCourse", back_populates="sentences")


class EnglishCourseProgress(Base):
    __tablename__ = "english_course_progress"
    __table_args__ = (
        Index("ix_english_course_progress_completed_updated", "is_completed", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("english_courses.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    current_sentence_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_sentence_indexes_json: Mapped[str] = mapped_column(Text, default="[]")
    is_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    course: Mapped[EnglishCourse] = relationship("EnglishCourse", back_populates="progress")


class EnglishGenerationTask(Base):
    __tablename__ = "english_generation_tasks"
    __table_args__ = (
        Index("ix_english_generation_tasks_status_created", "status", "created_at"),
        Index("ix_english_generation_tasks_course_id", "course_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued")
    stage: Mapped[str] = mapped_column(String(40), nullable=False, default="queued")
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    message: Mapped[str] = mapped_column(Text, default="")
    source_filename: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    source_media_path: Mapped[str] = mapped_column(String(600), nullable=False, default="")
    source_mime_type: Mapped[str] = mapped_column(String(120), nullable=False, default="video/mp4")
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str] = mapped_column(Text, default="")
    course_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
