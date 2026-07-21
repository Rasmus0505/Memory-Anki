"""English course domain ORM tables."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text
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


class EnglishTopicPattern(Base):
    """Topic-level sentence pattern pond (句模)."""

    __tablename__ = "english_topic_patterns"
    __table_args__ = (
        Index("ix_english_topic_patterns_status_updated", "status", "updated_at"),
        Index("ix_english_topic_patterns_updated", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # draft | learning | speakable | mature | archived
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    prompts: Mapped[list[EnglishPatternPrompt]] = relationship(
        "EnglishPatternPrompt",
        back_populates="pattern",
        cascade="all, delete-orphan",
        order_by="EnglishPatternPrompt.prompt_index",
    )
    sentences: Mapped[list[EnglishPatternSentence]] = relationship(
        "EnglishPatternSentence",
        back_populates="pattern",
        cascade="all, delete-orphan",
        order_by="EnglishPatternSentence.sentence_index",
    )


class EnglishPatternPrompt(Base):
    """High-frequency question under a topic pattern."""

    __tablename__ = "english_pattern_prompts"
    __table_args__ = (
        Index("ix_english_pattern_prompts_pattern_index", "pattern_id", "prompt_index"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pattern_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("english_topic_patterns.id", ondelete="CASCADE"),
        nullable=False,
    )
    prompt_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    text_zh: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    pattern: Mapped[EnglishTopicPattern] = relationship(
        "EnglishTopicPattern",
        back_populates="prompts",
    )
    sentences: Mapped[list[EnglishPatternSentence]] = relationship(
        "EnglishPatternSentence",
        back_populates="prompt",
        cascade="all, delete-orphan",
        order_by="EnglishPatternSentence.sentence_index",
    )


class EnglishPatternSentence(Base):
    """Viewpoint long sentence — primary FSRS review unit."""

    __tablename__ = "english_pattern_sentences"
    __table_args__ = (
        Index("ix_english_pattern_sentences_due", "status", "due_at", "next_due_at"),
        Index("ix_english_pattern_sentences_pattern", "pattern_id", "status"),
        Index("ix_english_pattern_sentences_prompt", "prompt_id", "sentence_index"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pattern_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("english_topic_patterns.id", ondelete="CASCADE"),
        nullable=False,
    )
    prompt_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("english_pattern_prompts.id", ondelete="CASCADE"),
        nullable=False,
    )
    sentence_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    text_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    text_zh: Mapped[str] = mapped_column(Text, nullable=False, default="")
    slots_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    collocations_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # manual | from_listening | from_reading | ai
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    source_course_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_sentence_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_material_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    review_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    incorrect_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_type: Mapped[str] = mapped_column(String(20), nullable=False, default="fsrs")
    algorithm_used: Mapped[str] = mapped_column(String(30), nullable=False, default="FSRS")
    anchor_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    fsrs_state: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    fsrs_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_review_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    desired_retention: Mapped[float] = mapped_column(Float, nullable=False, default=0.9)
    maximum_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    scheduler_version: Mapped[str] = mapped_column(String(32), nullable=False, default="fsrs-6.3.1")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    pattern: Mapped[EnglishTopicPattern] = relationship(
        "EnglishTopicPattern",
        back_populates="sentences",
    )
    prompt: Mapped[EnglishPatternPrompt] = relationship(
        "EnglishPatternPrompt",
        back_populates="sentences",
    )
