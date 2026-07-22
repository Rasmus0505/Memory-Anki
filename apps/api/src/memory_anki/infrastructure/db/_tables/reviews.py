"""Node-level spaced repetition state, rating ops, waves, and calibration tables."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from memory_anki.core.time import utc_now_naive

from ._base import Base


class ReviewNodeState(Base):
    __tablename__ = "review_node_states"
    __table_args__ = (
        UniqueConstraint("palace_id", "node_uid", name="uq_review_node_states_palace_node"),
        Index("ix_review_node_states_due", "due_at", "palace_id"),
        Index("ix_review_node_states_palace_due", "palace_id", "due_at"),
        Index("ix_review_node_states_wave", "effective_wave_id"),
        Index("ix_review_node_states_schedule_source", "palace_id", "schedule_source"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    state: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Effective formal due (wave-projected). Used by legacy queue projections.
    due_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    # Raw FSRS suggestion before wave adsorption.
    raw_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_review_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_direct_review_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_practice_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    desired_retention: Mapped[float] = mapped_column(Float, nullable=False, default=0.9)
    maximum_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    content_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    state_source: Mapped[str] = mapped_column(String(24), nullable=False, default="new")
    # new | manual | practice | batch_inherited | calibrated | legacy_estimate | content_changed | uninitialized
    schedule_source: Mapped[str] = mapped_column(String(32), nullable=False, default="new")
    evidence_source: Mapped[str] = mapped_column(String(24), nullable=False, default="none")
    # Soft reference to review_waves.id (no FK — avoids create_all ordering issues).
    effective_wave_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    effective_local_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    schedule_reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
    scheduler_version: Mapped[str] = mapped_column(String(32), nullable=False, default="fsrs-6.3.1")
    parameter_version: Mapped[str] = mapped_column(String(32), nullable=False, default="default")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive)


class ReviewRatingOperation(Base):
    __tablename__ = "review_rating_operations"
    __table_args__ = (
        Index("ix_review_rating_operations_session_created", "study_session_id", "created_at"),
        Index("ix_review_rating_operations_palace_created", "palace_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    study_session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    root_node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    rating_scope: Mapped[str] = mapped_column(String(16), nullable=False, default="single")
    affected_node_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)


class ReviewRatingOperationItem(Base):
    __tablename__ = "review_rating_operation_items"
    __table_args__ = (
        UniqueConstraint("operation_id", "node_uid", name="uq_review_rating_operation_items_node"),
        Index("ix_review_rating_operation_items_node", "palace_id", "node_uid", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(String(64), ForeignKey("review_rating_operations.id", ondelete="CASCADE"), nullable=False)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    before_state_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_state_json: Mapped[str] = mapped_column(Text, nullable=False)
    before_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)


class ReviewWave(Base):
    """Palace-scoped formal or same-day reinforcement wave."""

    __tablename__ = "review_waves"
    __table_args__ = (
        Index("ix_review_waves_palace_status", "palace_id", "status"),
        Index("ix_review_waves_palace_type_date", "palace_id", "wave_type", "local_date"),
        Index("ix_review_waves_palace_available", "palace_id", "wave_type", "available_at"),
        # At most one active/paused formal wave per palace (partial unique via migration index).
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    # formal_long_term | same_day_reinforcement
    wave_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # scheduled | active | paused | completed | cancelled
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled")
    # Local calendar day for formal waves (stored as date).
    local_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Concrete availability for reinforcement waves (UTC-naive).
    available_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive)


class ReviewWaveItem(Base):
    __tablename__ = "review_wave_items"
    __table_args__ = (
        UniqueConstraint("wave_id", "node_uid", name="uq_review_wave_items_wave_node"),
        Index("ix_review_wave_items_palace_node", "palace_id", "node_uid"),
        Index("ix_review_wave_items_wave_status", "wave_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wave_id: Mapped[str] = mapped_column(String(64), ForeignKey("review_waves.id", ondelete="CASCADE"), nullable=False)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    # pending | rated_direct | rated_inherited | pending_reinforcement | done | content_changed
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    evidence_origin: Mapped[str | None] = mapped_column(String(24), nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rating_operation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    frozen_raw_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    frozen_effective_due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    included_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive)


class ReviewCalibrationOperation(Base):
    __tablename__ = "review_calibration_operations"
    __table_args__ = (
        UniqueConstraint("id", name="uq_review_calibration_operations_id"),
        Index("ix_review_calibration_ops_palace_created", "palace_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    # align_wave | baseline
    mode: Mapped[str] = mapped_column(String(24), nullable=False)
    # palace | branch | nodes
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    scope_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    baseline_tier: Mapped[str | None] = mapped_column(String(24), nullable=True)
    palace_revision: Mapped[str | None] = mapped_column(String(64), nullable=True)
    preview_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    affected_node_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)


class ReviewCalibrationOperationItem(Base):
    __tablename__ = "review_calibration_operation_items"
    __table_args__ = (
        UniqueConstraint("operation_id", "node_uid", name="uq_review_calibration_items_node"),
        Index("ix_review_calibration_items_palace_node", "palace_id", "node_uid"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("review_calibration_operations.id", ondelete="CASCADE"), nullable=False
    )
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    before_state_json: Mapped[str] = mapped_column(Text, nullable=False)
    after_state_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
