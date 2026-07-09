from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class OverdueCountResponse(BaseModel):
    count: int


class ChapterInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    name: str
    subject_id: int | None = None


class ReviewScheduleItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    palace_id: int
    scheduled_date: str
    interval_days: int | None = None
    algorithm_used: str | None = None
    completed: bool
    completed_at: str | None = None
    review_number: int | None = None
    review_type: str | None = None
    palace: dict[str, Any] | None = None


class GroupedReviewScheduleItem(ReviewScheduleItem):
    schedule_count: int
    overdue_schedule_count: int
    next_due_date: str


class ReviewQueueResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    due_count: int
    overdue_count: int
    smoothed_count: int
    stats: dict[str, Any]
    chapter: ChapterInfo | None = None
    reviews: list[GroupedReviewScheduleItem]


class SubmitReviewResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
    completion_mode: str | None = None
    score: float | None = None
    next_id: int | None = None
    mastered: bool = False
