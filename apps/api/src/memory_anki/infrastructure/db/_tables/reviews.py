"""Node-level spaced repetition state and rating operation tables."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from memory_anki.core.time import utc_now_naive

from ._base import Base


class ReviewNodeState(Base):
    __tablename__ = "review_node_states"
    __table_args__ = (
        UniqueConstraint("palace_id", "node_uid", name="uq_review_node_states_palace_node"),
        Index("ix_review_node_states_due", "due_at", "palace_id"),
        Index("ix_review_node_states_palace_due", "palace_id", "due_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    palace_id: Mapped[int] = mapped_column(Integer, ForeignKey("palaces.id", ondelete="CASCADE"), nullable=False)
    node_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    state: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    due_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    last_review_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    desired_retention: Mapped[float] = mapped_column(Float, nullable=False, default=0.9)
    maximum_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    content_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    state_source: Mapped[str] = mapped_column(String(24), nullable=False, default="new")
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
