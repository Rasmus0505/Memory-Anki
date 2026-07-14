from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


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
    due_at: str | None = None
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
    later_today_count: int
    overdue_count: int
    smoothed_count: int
    stats: dict[str, Any]
    chapter: ChapterInfo | None = None
    reviews: list[GroupedReviewScheduleItem]
    later_today_reviews: list[GroupedReviewScheduleItem]


class SubmitReviewResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
    completion_mode: str | None = None
    score: float | None = None
    next_id: int | None = None
    mastered: bool = False
    review_log_id: int
    palace_id: int
    chapter_id: int | None = None
    duration_seconds: int
    completed_stage_count: int
    total_stage_count: int
    completed_stage_label: str | None = None
    next_stage_label: str | None = None
    next_review_at: str | None = None
    needs_practice: bool = False

class ReviewStageAdjustmentPreviewRequest(BaseModel):
    target_completed_count: int = Field(ge=0)
    completed_at: datetime | None = None
    needs_practice: bool = False


class ReviewStageAdjustmentRequest(ReviewStageAdjustmentPreviewRequest):
    expected_completed_count: int = Field(ge=0)
    note: str = Field(default="", max_length=2000)


class ReviewStageAdjustmentResponse(BaseModel):
    ok: bool
    palace_id: int
    palace_title: str
    previous_completed_count: int
    target_completed_count: int
    total_stage_count: int
    direction: Literal["forward", "backward", "reset", "unchanged"]
    current_stage_label: str | None = None
    target_stage_label: str | None = None
    preserved_stage_labels: list[str]
    added_stage_labels: list[str]
    removed_stage_labels: list[str]
    next_stage_label: str | None = None
    next_review_at: str | None = None
    mastered: bool
    needs_practice: bool
