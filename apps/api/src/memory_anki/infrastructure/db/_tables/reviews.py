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
    # Soft reference to review_waves.id (no FK - avoids create_all ordering issues).
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


class FsrsParameterSet(Base):
    """Optimizer-produced FSRS weight sets; at most one row status=active."""

    __tablename__ = "fsrs_parameter_sets"
    __table_args__ = (Index("ix_fsrs_parameter_sets_status", "status"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    weights_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # default | optimized
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="optimized")
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    log_loss_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    log_loss_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    calibration_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # candidate | running | active | rolled_back | failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="candidate")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PalaceReviewSettings(Base):
    """Per-palace scheduling overrides (aggregation layer + daily quotas)."""

    __tablename__ = "palace_review_settings"

    palace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("palaces.id", ondelete="CASCADE"), primary_key=True
    )
    aggregation_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    aggregation_max_pull_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    aggregation_max_push_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    daily_new_limit_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    daily_review_limit_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )


class ReviewDailyPlan(Base):
    """Daily task plan: which cards count toward today's review/new quotas."""

    __tablename__ = "review_daily_plans"
    __table_args__ = (
        UniqueConstraint(
            "local_date", "scope", "palace_id", name="uq_review_daily_plans_date_scope"
        ),
        Index("ix_review_daily_plans_date", "local_date"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    # palace | english_pattern | english_vocab
    scope: Mapped[str] = mapped_column(String(24), nullable=False, default="palace")
    palace_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=True
    )
    review_quota: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    new_quota: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    regenerated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ReviewDailyPlanItem(Base):
    __tablename__ = "review_daily_plan_items"
    __table_args__ = (
        UniqueConstraint("plan_id", "item_key", name="uq_review_daily_plan_items_key"),
        Index("ix_review_daily_plan_items_status", "plan_id", "kind", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("review_daily_plans.id", ondelete="CASCADE"), nullable=False
    )
    palace_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # palace scope: "{palace_id}:{node_uid}"; english scopes: row id.
    item_key: Mapped[str] = mapped_column(String(192), nullable=False)
    # review | new
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    # pending | done | deferred
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")
    # over_review_quota | over_new_quota
    defer_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )


class FreestyleTemporaryMark(Base):
    """Active temporary freestyle split roots until Good/Easy settlement."""

    __tablename__ = "freestyle_temporary_marks"
    __table_args__ = (
        UniqueConstraint("palace_id", "node_uid", name="uq_freestyle_temp_marks_palace_node"),
        Index("ix_freestyle_temp_marks_palace", "palace_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False
    )
    node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )

