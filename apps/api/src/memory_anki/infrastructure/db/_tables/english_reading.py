"""English reading domain ORM tables: profiles, materials, versions, sessions, caches."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from memory_anki.core.time import utc_now_naive

from ._base import Base


class EnglishReadingProfile(Base):
    __tablename__ = "english_reading_profiles"
    __table_args__ = (
        Index("ix_english_reading_profiles_updated_at", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    declared_cefr: Mapped[str] = mapped_column(String(8), nullable=False, default="B1")
    working_lexical_i: Mapped[str] = mapped_column(String(32), nullable=False, default="2.4")
    working_syntactic_i: Mapped[str] = mapped_column(String(32), nullable=False, default="2.2")
    xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    confidence: Mapped[str] = mapped_column(String(32), nullable=False, default="0.35")
    easy_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hard_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )


class EnglishReadingMaterial(Base):
    __tablename__ = "english_reading_materials"
    __table_args__ = (
        Index("ix_english_reading_materials_updated_at", "updated_at"),
        Index("ix_english_reading_materials_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="paste")
    original_filename: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    original_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    cleaned_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    word_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    versions: Mapped[list[EnglishReadingVersion]] = relationship(
        "EnglishReadingVersion",
        back_populates="material",
        cascade="all, delete-orphan",
        order_by="EnglishReadingVersion.created_at",
    )
    sessions: Mapped[list[EnglishReadingSession]] = relationship(
        "EnglishReadingSession",
        back_populates="material",
        cascade="all, delete-orphan",
        order_by="EnglishReadingSession.completed_at",
    )


class EnglishReadingVersion(Base):
    __tablename__ = "english_reading_versions"
    __table_args__ = (
        Index("ix_english_reading_versions_material_created", "material_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("english_reading_materials.id", ondelete="CASCADE"),
        nullable=False,
    )
    declared_cefr: Mapped[str] = mapped_column(String(8), nullable=False, default="B1")
    working_lexical_i: Mapped[str] = mapped_column(String(32), nullable=False, default="2.4")
    working_syntactic_i: Mapped[str] = mapped_column(String(32), nullable=False, default="2.2")
    target_cefr: Mapped[str] = mapped_column(String(8), nullable=False, default="B2")
    target_lexical_i: Mapped[str] = mapped_column(String(32), nullable=False, default="3.0")
    target_syntactic_i: Mapped[str] = mapped_column(String(32), nullable=False, default="2.8")
    render_blocks_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    span_annotations_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    sentence_annotations_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    summary_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)

    material: Mapped[EnglishReadingMaterial] = relationship(
        "EnglishReadingMaterial",
        back_populates="versions",
    )
    sessions: Mapped[list[EnglishReadingSession]] = relationship(
        "EnglishReadingSession",
        back_populates="version",
        cascade="all, delete-orphan",
        order_by="EnglishReadingSession.completed_at",
    )


class EnglishReadingSession(Base):
    __tablename__ = "english_reading_sessions"
    __table_args__ = (
        Index("ix_english_reading_sessions_material_completed", "material_id", "completed_at"),
        Index("ix_english_reading_sessions_completed_at", "completed_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("english_reading_materials.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("english_reading_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    feedback: Mapped[str] = mapped_column(String(24), nullable=False, default="just_right")
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    words_per_minute: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hover_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expand_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    xp_awarded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calibration_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)

    material: Mapped[EnglishReadingMaterial] = relationship(
        "EnglishReadingMaterial",
        back_populates="sessions",
    )
    version: Mapped[EnglishReadingVersion | None] = relationship(
        "EnglishReadingVersion",
        back_populates="sessions",
    )


class EnglishReadingVocabularyNote(Base):
    __tablename__ = "english_reading_vocabulary_notes"
    __table_args__ = (
        Index("ix_english_reading_vocabulary_notes_due", "status", "next_due_date", "next_due_at"),
        Index("ix_english_reading_vocabulary_notes_updated", "updated_at"),
        Index("ix_english_reading_vocabulary_notes_material", "material_id", "version_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    normalized_surface: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    word: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    lemma: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    cefr: Mapped[str] = mapped_column(String(8), nullable=False, default="")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    definition_zh: Mapped[str] = mapped_column(Text, nullable=False, default="")
    context: Mapped[str] = mapped_column(Text, nullable=False, default="")
    material_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("english_reading_materials.id", ondelete="SET NULL"),
        nullable=True,
    )
    version_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("english_reading_versions.id", ondelete="SET NULL"),
        nullable=True,
    )
    span_annotation_id: Mapped[str] = mapped_column(String(80), nullable=False, default="")
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
    # FSRS card fields (aligned with ReviewNodeState)
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


class EnglishReadingLexiconCache(Base):
    __tablename__ = "english_reading_lexicon_cache"
    __table_args__ = (
        Index("ix_english_reading_lexicon_cache_updated", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    normalized_surface: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    lemma: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    base_phrase: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    cefr: Mapped[str] = mapped_column(String(8), nullable=False, default="B2")
    confidence: Mapped[str] = mapped_column(String(32), nullable=False, default="0.6")
    explain_zh: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="llm")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )


class EnglishReadingDictionaryCache(Base):
    __tablename__ = "english_reading_dictionary_cache"
    __table_args__ = (
        Index("ix_english_reading_dictionary_cache_updated", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    normalized_surface: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    entry_word: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    lemma: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    phonetic_us: Mapped[str] = mapped_column(String(240), nullable=False, default="")
    audio_us_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    summary_zh_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    parts_of_speech_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    senses_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="xxapi")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )
