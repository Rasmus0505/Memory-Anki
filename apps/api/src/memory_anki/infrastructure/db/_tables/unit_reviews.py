"""Permanent-mark review unit state and rating history."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from memory_anki.core.time import utc_now_naive

from ._base import Base


class ReviewUnitState(Base):
    __tablename__ = "review_unit_states"
    __table_args__ = (
        Index("ix_review_unit_states_due", "active", "due_date", "palace_id"),
        Index("ix_review_unit_states_palace", "palace_id", "active"),
        Index(
            "uq_review_unit_states_active_anchor",
            "palace_id",
            "anchor_uid",
            unique=True,
            sqlite_where=text("active = 1"),
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    palace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False
    )
    anchor_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    unit_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    node_uids_json: Mapped[str] = mapped_column(Text, nullable=False)
    membership_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    stage_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    has_passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    last_passed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )


class ReviewUnitEncounter(Base):
    __tablename__ = "review_unit_encounters"
    __table_args__ = (
        UniqueConstraint(
            "study_session_id",
            "unit_id",
            "sequence",
            name="uq_review_unit_encounters_sequence",
        ),
        Index(
            "uq_review_unit_encounters_open",
            "study_session_id",
            "unit_id",
            unique=True,
            sqlite_where=text("status = 'open'"),
        ),
        Index("ix_review_unit_encounters_round", "round_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    study_session_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False
    )
    unit_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("review_unit_states.id", ondelete="CASCADE"),
        nullable=False,
    )
    unit_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    round_id: Mapped[str] = mapped_column(String(128), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    baseline_state_json: Mapped[str] = mapped_column(Text, nullable=False)
    effective_operation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    selected_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    retry_after_cards: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    close_operation_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )


class ReviewUnitRatingOperation(Base):
    __tablename__ = "review_unit_rating_operations"
    __table_args__ = (
        Index(
            "ix_review_unit_rating_operations_session",
            "study_session_id",
            "created_at",
        ),
        Index("ix_review_unit_rating_operations_unit", "unit_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    encounter_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("review_unit_encounters.id", ondelete="CASCADE"),
        nullable=False,
    )
    study_session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    unit_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("review_unit_states.id", ondelete="CASCADE"),
        nullable=False,
    )
    palace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False
    )
    unit_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    retry_after_cards: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    before_state_json: Mapped[str] = mapped_column(Text, nullable=False)
    after_state_json: Mapped[str] = mapped_column(Text, nullable=False)
    replaces_operation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    replaced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive
    )


class ReviewSessionUnit(Base):
    __tablename__ = "review_session_units"
    __table_args__ = (
        UniqueConstraint(
            "study_session_id", "unit_id", name="uq_review_session_units_session_unit"
        ),
        Index("ix_review_session_units_status", "study_session_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    study_session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    unit_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("review_unit_states.id", ondelete="CASCADE"),
        nullable=False,
    )
    unit_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    node_uids_json: Mapped[str] = mapped_column(Text, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hard_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    again_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    final_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )


class ReviewUnitScheduleBatch(Base):
    """Checkpoint of schedule demotions from content reconcile, for later undo."""

    __tablename__ = "review_unit_schedule_batches"
    __table_args__ = (
        Index(
            "ix_review_unit_schedule_batches_palace",
            "palace_id",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    palace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False
    )
    reason: Mapped[str] = mapped_column(String(32), nullable=False, default="content_reconcile")
    entries_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive
    )
    undone_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


__all__ = [
    "ReviewSessionUnit",
    "ReviewUnitEncounter",
    "ReviewUnitRatingOperation",
    "ReviewUnitScheduleBatch",
    "ReviewUnitState",
]
