from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship

from memory_anki.core.config import DATABASE_URL, ensure_runtime_dirs
from memory_anki.core.time import utc_now_naive

ensure_runtime_dirs()
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class Base(DeclarativeBase):
    pass


chapter_palace_table = Table(
    "chapter_palaces",
    Base.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("chapter_id", Integer, ForeignKey("chapters.id", ondelete="CASCADE")),
    Column("palace_id", Integer, ForeignKey("palaces.id", ondelete="CASCADE")),
    Column("is_explicit", Boolean, nullable=False, default=True),
)


class Palace(Base):
    __tablename__ = "palaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    difficulty: Mapped[int] = mapped_column(Integer, default=3)
    review_mode: Mapped[str] = mapped_column(String(20), default="flashcard")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    mastered: Mapped[bool] = mapped_column(Boolean, default=False)
    needs_practice: Mapped[bool] = mapped_column(Boolean, default=False)
    focus_node_uids_json: Mapped[str] = mapped_column(Text, default="[]")
    editor_doc: Mapped[str] = mapped_column(Text, default="")
    editor_config: Mapped[str] = mapped_column(Text, default="")
    editor_local_config: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    pegs: Mapped[list[Peg]] = relationship(
        "Peg",
        back_populates="palace",
        cascade="all, delete-orphan",
        primaryjoin="and_(Peg.palace_id==Palace.id, Peg.parent_id==None)",
        order_by="Peg.sort_order",
    )
    attachments: Mapped[list[Attachment]] = relationship(
        "Attachment",
        back_populates="palace",
        cascade="all, delete-orphan",
    )
    review_schedules: Mapped[list[ReviewSchedule]] = relationship(
        "ReviewSchedule",
        back_populates="palace",
        cascade="all, delete-orphan",
    )
    review_logs: Mapped[list[ReviewLog]] = relationship(
        "ReviewLog",
        back_populates="palace",
        cascade="all, delete-orphan",
    )
    chapters: Mapped[list[Chapter]] = relationship(
        "Chapter",
        secondary=chapter_palace_table,
        back_populates="palaces",
    )
    versions: Mapped[list[PalaceVersion]] = relationship(
        "PalaceVersion",
        back_populates="palace",
        cascade="all, delete-orphan",
    )
    segments: Mapped[list[PalaceSegment]] = relationship(
        "PalaceSegment",
        back_populates="palace",
        cascade="all, delete-orphan",
        order_by="PalaceSegment.sort_order",
    )
    mini_palaces: Mapped[list[PalaceMiniPalace]] = relationship(
        "PalaceMiniPalace",
        back_populates="palace",
        cascade="all, delete-orphan",
        order_by="PalaceMiniPalace.sort_order",
    )

    primary_chapter_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("chapters.id"), nullable=True
    )
    group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    group_sort_order: Mapped[int] = mapped_column(Integer, default=0)
    title_mode: Mapped[str] = mapped_column(String(20), default="sync")
    manual_title: Mapped[str] = mapped_column(String(200), default="")
    grouping_mode: Mapped[str] = mapped_column(String(20), default="auto")
    manual_group_chapter_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    primary_chapter: Mapped["Chapter | None"] = relationship(
        "Chapter", foreign_keys=[primary_chapter_id], lazy="joined"
    )


class Peg(Base):
    __tablename__ = "pegs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
    )
    parent_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("pegs.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    palace: Mapped[Palace] = relationship("Palace", back_populates="pegs")
    children: Mapped[list[Peg]] = relationship(
        "Peg",
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="Peg.sort_order",
    )
    parent: Mapped[Peg | None] = relationship(
        "Peg",
        back_populates="children",
        remote_side="Peg.id",
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
    )
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0)

    palace: Mapped[Palace] = relationship("Palace", back_populates="attachments")


class PalaceSegment(Base):
    __tablename__ = "palace_segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    color: Mapped[str] = mapped_column(String(24), nullable=False, default="#14b8a6")
    node_uids_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    palace: Mapped[Palace] = relationship("Palace", back_populates="segments")
    review_schedules: Mapped[list[PalaceSegmentReviewSchedule]] = relationship(
        "PalaceSegmentReviewSchedule",
        back_populates="segment",
        cascade="all, delete-orphan",
    )
    review_logs: Mapped[list[PalaceSegmentReviewLog]] = relationship(
        "PalaceSegmentReviewLog",
        back_populates="segment",
        cascade="all, delete-orphan",
    )


class PalaceMiniPalace(Base):
    __tablename__ = "palace_mini_palaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    node_uids_json: Mapped[str] = mapped_column(Text, default="[]")
    needs_practice: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    palace: Mapped[Palace] = relationship("Palace", back_populates="mini_palaces")
    review_schedules: Mapped[list[PalaceMiniPalaceReviewSchedule]] = relationship(
        "PalaceMiniPalaceReviewSchedule",
        back_populates="mini_palace",
        cascade="all, delete-orphan",
    )
    review_logs: Mapped[list[PalaceMiniPalaceReviewLog]] = relationship(
        "PalaceMiniPalaceReviewLog",
        back_populates="mini_palace",
        cascade="all, delete-orphan",
    )


class ReviewSchedule(Base):
    __tablename__ = "review_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
    )
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    interval_days: Mapped[int] = mapped_column(Integer, default=0)
    algorithm_used: Mapped[str] = mapped_column(String(30), default="ebbinghaus")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_number: Mapped[int] = mapped_column(Integer, default=0)
    review_type: Mapped[str] = mapped_column(String(20), default="standard")
    anchor_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    palace: Mapped[Palace] = relationship("Palace", back_populates="review_schedules")


class ReviewLog(Base):
    __tablename__ = "review_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
    )
    review_date: Mapped[date | None] = mapped_column(Date, default=date.today)
    score: Mapped[int] = mapped_column(Integer, default=0)
    review_mode: Mapped[str] = mapped_column(String(20), default="flashcard")
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)

    palace: Mapped[Palace] = relationship("Palace", back_populates="review_logs")


class PalaceSegmentReviewSchedule(Base):
    __tablename__ = "palace_segment_review_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_segment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palace_segments.id", ondelete="CASCADE"),
        nullable=False,
    )
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    interval_days: Mapped[int] = mapped_column(Integer, default=0)
    algorithm_used: Mapped[str] = mapped_column(String(30), default="ebbinghaus")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_number: Mapped[int] = mapped_column(Integer, default=0)
    review_type: Mapped[str] = mapped_column(String(20), default="standard")
    anchor_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    segment: Mapped[PalaceSegment] = relationship(
        "PalaceSegment",
        back_populates="review_schedules",
    )


class PalaceSegmentReviewLog(Base):
    __tablename__ = "palace_segment_review_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_segment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palace_segments.id", ondelete="CASCADE"),
        nullable=False,
    )
    review_date: Mapped[date | None] = mapped_column(Date, default=date.today)
    score: Mapped[int] = mapped_column(Integer, default=0)
    review_mode: Mapped[str] = mapped_column(String(20), default="flashcard")
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)

    segment: Mapped[PalaceSegment] = relationship(
        "PalaceSegment",
        back_populates="review_logs",
    )


class PalaceMiniPalaceReviewSchedule(Base):
    __tablename__ = "palace_mini_palace_review_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_mini_palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palace_mini_palaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    interval_days: Mapped[int] = mapped_column(Integer, default=0)
    algorithm_used: Mapped[str] = mapped_column(String(30), default="ebbinghaus")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_number: Mapped[int] = mapped_column(Integer, default=0)
    review_type: Mapped[str] = mapped_column(String(20), default="standard")
    anchor_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    mini_palace: Mapped[PalaceMiniPalace] = relationship(
        "PalaceMiniPalace",
        back_populates="review_schedules",
    )


class PalaceMiniPalaceReviewLog(Base):
    __tablename__ = "palace_mini_palace_review_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_mini_palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palace_mini_palaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    review_date: Mapped[date | None] = mapped_column(Date, default=date.today)
    score: Mapped[int] = mapped_column(Integer, default=0)
    review_mode: Mapped[str] = mapped_column(String(20), default="flashcard")
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)

    mini_palace: Mapped[PalaceMiniPalace] = relationship(
        "PalaceMiniPalace",
        back_populates="review_logs",
    )


class SessionProgress(Base):
    __tablename__ = "session_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    palace_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
        nullable=True,
    )
    review_schedule_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("review_schedules.id", ondelete="CASCADE"),
        nullable=True,
    )
    palace_segment_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palace_segments.id", ondelete="CASCADE"),
        nullable=True,
    )
    mini_palace_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palace_mini_palaces.id", ondelete="CASCADE"),
        nullable=True,
    )
    palace_segment_review_schedule_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palace_segment_review_schedules.id", ondelete="CASCADE"),
        nullable=True,
    )
    mini_palace_review_schedule_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palace_mini_palace_review_schedules.id", ondelete="CASCADE"),
        nullable=True,
    )
    reveal_map: Mapped[str] = mapped_column(Text, default="{}")
    red_node_ids: Mapped[str] = mapped_column(Text, default="[]")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#6366f1")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    editor_doc: Mapped[str] = mapped_column(Text, default="")
    editor_config: Mapped[str] = mapped_column(Text, default="")
    editor_local_config: Mapped[str] = mapped_column(Text, default="")

    chapters: Mapped[list[Chapter]] = relationship(
        "Chapter",
        back_populates="subject",
        cascade="all, delete-orphan",
        order_by="Chapter.sort_order",
    )
    documents: Mapped[list[SubjectDocument]] = relationship(
        "SubjectDocument",
        back_populates="subject",
        cascade="all, delete-orphan",
        order_by="SubjectDocument.created_at.desc()",
    )


class SubjectDocument(Base):
    __tablename__ = "subject_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("subjects.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    original_name: Mapped[str] = mapped_column(String(300), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False, default="application/pdf")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)

    subject: Mapped[Subject] = relationship("Subject", back_populates="documents")


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("subjects.id", ondelete="CASCADE"),
    )
    parent_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("chapters.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")

    subject: Mapped[Subject] = relationship("Subject", back_populates="chapters")
    children: Mapped[list[Chapter]] = relationship(
        "Chapter",
        back_populates="parent",
        order_by="Chapter.sort_order",
    )
    parent: Mapped[Chapter | None] = relationship(
        "Chapter",
        back_populates="children",
        remote_side="Chapter.id",
    )
    palaces: Mapped[list[Palace]] = relationship(
        "Palace",
        secondary=chapter_palace_table,
        back_populates="chapters",
    )


class NodeConnection(Base):
    __tablename__ = "node_connections"
    __table_args__ = (
        Index(
            "ix_node_connections_style_source",
            "style",
            "source_type",
            "source_id",
        ),
        Index(
            "ix_node_connections_style_target",
            "style",
            "target_type",
            "target_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(200), default="")
    style: Mapped[str] = mapped_column(String(20), default="solid")


class Config(Base):
    __tablename__ = "config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)


class PalaceVersion(Base):
    __tablename__ = "palace_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    trigger_reason: Mapped[str] = mapped_column(String(50), default="manual_save")
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    created_at_value: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    editor_doc: Mapped[str] = mapped_column(Text, default="")
    editor_config: Mapped[str] = mapped_column(Text, default="")
    editor_local_config: Mapped[str] = mapped_column(Text, default="")
    peg_snapshot: Mapped[str] = mapped_column(Text, default="")
    chapter_snapshot: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)

    palace: Mapped[Palace] = relationship("Palace", back_populates="versions")


class PalaceGroup(Base):
    __tablename__ = "palace_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    color: Mapped[str] = mapped_column(String(24), nullable=False, default="#6366f1")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    source_chapter_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


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

    sentences: Mapped[list["EnglishSentence"]] = relationship(
        "EnglishSentence",
        back_populates="course",
        cascade="all, delete-orphan",
        order_by="EnglishSentence.sentence_index",
    )
    progress: Mapped["EnglishCourseProgress | None"] = relationship(
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

    versions: Mapped[list["EnglishReadingVersion"]] = relationship(
        "EnglishReadingVersion",
        back_populates="material",
        cascade="all, delete-orphan",
        order_by="EnglishReadingVersion.created_at",
    )
    sessions: Mapped[list["EnglishReadingSession"]] = relationship(
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

    material: Mapped["EnglishReadingMaterial"] = relationship(
        "EnglishReadingMaterial",
        back_populates="versions",
    )
    sessions: Mapped[list["EnglishReadingSession"]] = relationship(
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

    material: Mapped["EnglishReadingMaterial"] = relationship(
        "EnglishReadingMaterial",
        back_populates="sessions",
    )
    version: Mapped["EnglishReadingVersion | None"] = relationship(
        "EnglishReadingVersion",
        back_populates="sessions",
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


class TimeRecord(Base):
    __tablename__ = "time_records"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    palace_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="SET NULL"),
        nullable=True,
    )
    palace_segment_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palace_segments.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    english_course_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    effective_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pause_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_method: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="manual_complete",
    )
    duration_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    events_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )


class MindMapImportJob(Base):
    __tablename__ = "mindmap_import_jobs"
    __table_args__ = (
        Index(
            "ix_mindmap_import_jobs_entity_fingerprint",
            "entity_key",
            "fingerprint",
        ),
        Index(
            "ix_mindmap_import_jobs_entity_created",
            "entity_key",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_key: Mapped[str] = mapped_column(String(200), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="mindmap")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    stage: Mapped[str] = mapped_column(String(20), nullable=False, default="prepared")
    fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    source_meta_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    error_json: Mapped[str] = mapped_column(Text, default="{}")
    usage_json: Mapped[str] = mapped_column(Text, default="{}")
    progress_json: Mapped[str] = mapped_column(Text, default="{}")
    pause_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExternalAiCallLog(Base):
    __tablename__ = "external_ai_call_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    feature: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    operation: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    palace_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="started")
    provider: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    base_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    request_json: Mapped[str] = mapped_column(Text, default="{}")
    response_json: Mapped[str] = mapped_column(Text, default="{}")
    error_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)
