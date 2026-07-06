"""Palace / review / session domain ORM tables.

Palace, Peg, Attachment, segments, mini-palaces, the unified review
schedule/log tables, session progress, palace versions/groups, and the palace
quiz questions all live here. Relationships use string references so
cross-domain back-references resolve against the shared ``Base.metadata``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from memory_anki.core.time import utc_now_naive

from ._base import Base

if TYPE_CHECKING:
    # Chapter is defined in the knowledge tables module; imported only for
    # type-checking to satisfy static analyzers on the relationship annotations.
    from .knowledge import Chapter

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
    quiz_questions: Mapped[list[PalaceQuizQuestion]] = relationship(
        "PalaceQuizQuestion",
        back_populates="palace",
        cascade="all, delete-orphan",
        order_by="PalaceQuizQuestion.sort_order",
    )
    quiz_ocr_sources: Mapped[list[PalaceQuizOcrSource]] = relationship(
        "PalaceQuizOcrSource",
        back_populates="palace",
        cascade="all, delete-orphan",
        order_by="PalaceQuizOcrSource.page_number",
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
    primary_chapter: Mapped[Chapter | None] = relationship(
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
    __table_args__ = (
        Index("ix_palace_segments_palace_sort", "palace_id", "sort_order"),
    )

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


class PalaceMiniPalace(Base):
    __tablename__ = "palace_mini_palaces"
    __table_args__ = (
        Index("ix_palace_mini_palaces_palace_sort", "palace_id", "sort_order"),
    )

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
    quiz_questions: Mapped[list[PalaceQuizQuestion]] = relationship(
        "PalaceQuizQuestion",
        back_populates="mini_palace",
    )


class ReviewSchedule(Base):
    __tablename__ = "review_schedules"
    __table_args__ = (
        Index(
            "ix_review_schedules_due_lookup",
            "completed",
            "scheduled_date",
            "scheduled_at",
            "id",
        ),
        Index(
            "ix_review_schedules_palace_progress",
            "palace_id",
            "completed",
            "review_number",
        ),
    )

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

class SessionProgress(Base):
    __tablename__ = "session_progress"
    __table_args__ = (
        Index(
            "ix_session_progress_practice",
            "session_kind",
            "palace_id",
            unique=True,
            sqlite_where=text("session_kind = 'practice' AND palace_id IS NOT NULL"),
        ),
        Index(
            "ix_session_progress_review",
            "session_kind",
            "review_schedule_id",
            unique=True,
            sqlite_where=text("session_kind = 'review' AND review_schedule_id IS NOT NULL"),
        ),
        Index(
            "ix_session_progress_segment_practice",
            "session_kind",
            "palace_segment_id",
            unique=True,
            sqlite_where=text(
                "session_kind = 'segment_practice' AND palace_segment_id IS NOT NULL"
            ),
        ),
        Index(
            "ix_session_progress_mini_practice",
            "session_kind",
            "mini_palace_id",
            unique=True,
            sqlite_where=text("session_kind = 'mini_practice' AND mini_palace_id IS NOT NULL"),
        ),
        Index(
            "ix_session_progress_focus_practice",
            "session_kind",
            "palace_id",
            unique=True,
            sqlite_where=text("session_kind = 'focus_practice' AND palace_id IS NOT NULL"),
        ),
    )

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
    reveal_map: Mapped[str] = mapped_column(Text, default="{}")
    red_node_ids: Mapped[str] = mapped_column(Text, default="[]")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )


class PalaceVersion(Base):
    __tablename__ = "palace_versions"
    __table_args__ = (
        Index("ix_palace_versions_palace_id_created_at", "palace_id", "created_at"),
    )

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


class PalaceQuizQuestion(Base):
    __tablename__ = "palace_quiz_questions"
    __table_args__ = (
        CheckConstraint(
            "palace_id IS NOT NULL OR source_chapter_id IS NOT NULL",
            name="ck_palace_quiz_questions_owner",
        ),
        Index("ix_palace_quiz_questions_palace_sort", "palace_id", "sort_order"),
        Index("ix_palace_quiz_questions_updated_at", "updated_at"),
        Index("ix_palace_quiz_questions_mini_palace", "mini_palace_id"),
        Index("ix_palace_quiz_questions_origin_mini", "origin_question_id", "mini_palace_id"),
        Index("ix_palace_quiz_questions_source_chapter", "source_chapter_id"),
        Index("ix_palace_quiz_questions_classified_chapter", "classified_chapter_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
        nullable=True,
    )
    mini_palace_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("palace_mini_palaces.id", ondelete="CASCADE"),
        nullable=True,
    )
    source_chapter_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=True,
    )
    classified_chapter_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("chapters.id", ondelete="SET NULL"),
        nullable=True,
    )
    origin_question_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    question_type: Mapped[str] = mapped_column(String(32), nullable=False, default="multiple_choice")
    stem: Mapped[str] = mapped_column(Text, nullable=False, default="")
    options_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    answer_payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    analysis: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_meta_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    incorrect_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    palace: Mapped[Palace] = relationship("Palace", back_populates="quiz_questions")
    mini_palace: Mapped[PalaceMiniPalace | None] = relationship(
        "PalaceMiniPalace",
        back_populates="quiz_questions",
    )
    source_chapter: Mapped[Chapter | None] = relationship(
        "Chapter",
        foreign_keys=[source_chapter_id],
        lazy="joined",
    )
    classified_chapter: Mapped[Chapter | None] = relationship(
        "Chapter",
        foreign_keys=[classified_chapter_id],
        lazy="joined",
    )


class PalaceQuizOcrSource(Base):
    __tablename__ = "palace_quiz_ocr_sources"
    __table_args__ = (
        UniqueConstraint(
            "palace_id",
            "source_set",
            "page_key",
            "import_batch",
            name="uq_palace_quiz_ocr_sources_page_batch",
        ),
        Index("ix_palace_quiz_ocr_sources_palace", "palace_id"),
        Index(
            "ix_palace_quiz_ocr_sources_palace_source",
            "palace_id",
            "source_set",
            "page_number",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_kind: Mapped[str] = mapped_column(String(40), nullable=False, default="ocr")
    source_set: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    page_key: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    lines_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    source_meta_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    import_batch: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=utc_now_naive,
        onupdate=utc_now_naive,
    )

    palace: Mapped[Palace] = relationship("Palace", back_populates="quiz_ocr_sources")
