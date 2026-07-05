"""Compatibility facade for review application services."""

from __future__ import annotations

from .review_execution_service import (
    repair_review_stage_progress,
    submit_review,
    trigger_review_for_palace,
)
from .review_metrics_service import (
    get_palace_stats,
    get_today_formal_review_duration_seconds,
    get_today_practice_duration_seconds,
    get_weekly_formal_review_duration_seconds,
    get_weekly_practice_duration_seconds,
    get_weekly_stats,
)
from .review_queue_service import (
    get_chapter_queue_payload,
    get_due_count,
    get_next_due_review,
    get_overdue_count,
    get_review_queue_payload,
    get_today_review_groups,
    get_today_reviews,
    spread_overdue,
)

__all__ = [
    "get_chapter_queue_payload",
    "get_due_count",
    "get_next_due_review",
    "get_overdue_count",
    "get_palace_stats",
    "get_review_queue_payload",
    "get_today_formal_review_duration_seconds",
    "get_today_practice_duration_seconds",
    "get_today_review_groups",
    "get_today_reviews",
    "get_weekly_formal_review_duration_seconds",
    "get_weekly_practice_duration_seconds",
    "get_weekly_stats",
    "repair_review_stage_progress",
    "spread_overdue",
    "submit_review",
    "trigger_review_for_palace",
]
