from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class OverdueCountResponse(BaseModel):
    count: int


class MasteryTrendPoint(BaseModel):
    at: str
    mastery_progress: float
    mastery_percent: int


class MasteryTrendResponse(BaseModel):
    palace_id: int
    points: list[MasteryTrendPoint]


class ChapterInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    name: str
    subject_id: int | None = None


class ReviewScheduleItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | int
    palace_id: int
    scheduled_date: str | None = None
    due_at: str | None = None
    next_due_at: str | None = None
    interval_days: int | None = None
    algorithm_used: str | None = None
    completed: bool = False
    completed_at: str | None = None
    review_number: int | None = None
    review_type: str | None = None
    session_id: str | None = None
    due_node_count: int = 0
    overdue_node_count: int = 0
    frozen_due_node_uids: list[str] = []
    memory_summary: dict[str, Any] | None = None
    # Completed formal reviews for this palace today (node + palace each count 1).
    today_review_count: int = 0
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
    next_id: int | str | None = None
    review_log_id: int
    palace_id: int
    chapter_id: int | None = None
    duration_seconds: int
    scope_node_count: int = 0
    rated_node_count: int = 0
    unrated_due_node_count: int = 0
    rating_counts: dict[str, int] = {}
    mastery_progress: float = 0
    mastery_percent: int = 0
    memory_health: float = 0
    memory_health_percent: int = 0
    remaining_due_node_count: int = 0
    next_review_at: str | None = None
    next_review_node_count: int = 0
    next_review_entry_mode: str | None = None
    next_review_entry_label: str | None = None
    today_review_count: int = 0
