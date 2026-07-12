from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from memory_anki.core.time import utc_now_naive

from ._base import Base


class AiLearningRun(Base):
    __tablename__ = "ai_learning_runs"
    __table_args__ = (
        Index("ix_ai_learning_runs_thread_created", "thread_id", "created_at"),
        Index("ix_ai_learning_runs_review_session", "review_session_id", "created_at"),
        Index("ix_ai_learning_runs_palace", "palace_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    thread_id: Mapped[str] = mapped_column(String(36), nullable=False)
    parent_run_id: Mapped[str | None] = mapped_column(String(36))
    retry_of_run_id: Mapped[str | None] = mapped_column(String(36))
    owner_id: Mapped[str] = mapped_column(String(120), nullable=False)
    operation_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    scenario_key: Mapped[str] = mapped_column(String(80), nullable=False, default="review_ai_learning")
    entrypoint_key: Mapped[str] = mapped_column(String(120), nullable=False, default="review-ai-learning")
    review_session_id: Mapped[int | None] = mapped_column(Integer)
    palace_id: Mapped[int | None] = mapped_column(Integer)
    task_key: Mapped[str] = mapped_column(String(40), nullable=False)
    output_type: Mapped[str] = mapped_column(String(40), nullable=False, default="text")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    user_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    prompt_snapshot: Mapped[str] = mapped_column(Text, nullable=False, default="")
    context_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    context_selections_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    request_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    response_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    model_meta_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    warnings_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    error_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    feedback: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    application_status: Mapped[str] = mapped_column(String(24), nullable=False, default="previewed")
    application_result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utc_now_naive, onupdate=utc_now_naive
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
