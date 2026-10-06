"""Current-cycle quiz 已做. Question-owned, cleared only by an explicit action."""

from __future__ import annotations

from sqlalchemy import Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ._base import Base


class QuizPracticeProgress(Base):
    __tablename__ = "quiz_practice_progress"
    __table_args__ = (
        Index("ix_quiz_practice_progress_palace", "palace_id"),
    )

    question_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    palace_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    state_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False, default="")


class QuizPracticeProgressClear(Base):
    """Tombstones so a stale device cannot resurrect a cleared 已做."""

    __tablename__ = "quiz_practice_progress_clears"

    scope_key: Mapped[str] = mapped_column(String(48), primary_key=True)
    cleared_at: Mapped[str] = mapped_column(String(40), nullable=False, default="")
