"""Shadow FSRS state and per-rating comparison for review units.

These tables are deliberately separate from ``review_unit_states``: the shadow
scheduler never owns a due date. They can be dropped without changing any
learner-visible schedule.
"""

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
)
from sqlalchemy.orm import Mapped, mapped_column

from memory_anki.core.time import utc_now_naive

from ._base import Base


class ReviewUnitFsrsShadowState(Base):
    """The FSRS card state rebuilt from a unit's rating history."""

    __tablename__ = "review_unit_fsrs_shadow_states"

    unit_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("review_unit_states.id", ondelete="CASCADE"),
        primary_key=True,
    )
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    fsrs_state: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fsrs_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_review: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scheduler_version: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    desired_retention: Mapped[float] = mapped_column(Float, nullable=False, default=0.9)
    maximum_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=365)
    replayed_operations: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_operation_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )


class ReviewUnitFsrsShadowRating(Base):
    """One real rating, with both schedulers' projections side by side."""

    __tablename__ = "review_unit_fsrs_shadow_ratings"
    __table_args__ = (
        Index(
            "ix_review_unit_fsrs_shadow_ratings_unit",
            "unit_id",
            "created_at",
        ),
        Index(
            "ix_review_unit_fsrs_shadow_ratings_created",
            "created_at",
        ),
        Index(
            "ix_review_unit_fsrs_shadow_ratings_delta",
            "due_delta_days",
        ),
    )

    # The rating operation id is the idempotency key: replaying a request must
    # not add a second shadow row.
    id: Mapped[str] = mapped_column(String(256), primary_key=True)
    unit_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("review_unit_states.id", ondelete="CASCADE"),
        nullable=False,
    )
    palace_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("palaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    rated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    study_day: Mapped[date] = mapped_column(Date, nullable=False)

    ladder_stage_before: Mapped[int] = mapped_column(Integer, nullable=False)
    ladder_due_before: Mapped[date] = mapped_column(Date, nullable=False)
    ladder_has_passed_before: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ladder_stage_after: Mapped[int] = mapped_column(Integer, nullable=False)
    ladder_due_after: Mapped[date] = mapped_column(Date, nullable=False)
    ladder_interval_days: Mapped[int] = mapped_column(Integer, nullable=False)

    fsrs_state_before_json: Mapped[str] = mapped_column(Text, nullable=False)
    fsrs_state_after_json: Mapped[str] = mapped_column(Text, nullable=False)
    fsrs_due_raw: Mapped[date | None] = mapped_column(Date, nullable=True)
    fsrs_due_product: Mapped[date] = mapped_column(Date, nullable=False)
    fsrs_interval_raw_days: Mapped[int] = mapped_column(Integer, nullable=False)
    fsrs_interval_days: Mapped[int] = mapped_column(Integer, nullable=False)

    due_delta_days: Mapped[int] = mapped_column(Integer, nullable=False)
    interval_delta_days: Mapped[int] = mapped_column(Integer, nullable=False)
    schedule_changed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    schedule_locked: Mapped[bool] = mapped_column(Boolean, nullable=False)
    hard_penalized_today: Mapped[bool] = mapped_column(Boolean, nullable=False)
    hard_penalty_applied: Mapped[bool] = mapped_column(Boolean, nullable=False)
    fsrs_applied: Mapped[bool] = mapped_column(Boolean, nullable=False)
    horizon_applied: Mapped[bool] = mapped_column(Boolean, nullable=False)
    fuzz_applied: Mapped[bool] = mapped_column(Boolean, nullable=False)
    scheduler_version: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive
    )


__all__ = ["ReviewUnitFsrsShadowRating", "ReviewUnitFsrsShadowState"]
