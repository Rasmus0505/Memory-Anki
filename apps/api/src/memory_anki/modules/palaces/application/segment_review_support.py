from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceSegment
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    infer_completed_stage_count as infer_schedule_completed_stage_count,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_intervals,
    get_config_value,
)

from .review_progress_datetime import serialize_stage_datetime


def get_segment_anchor_date(segment: PalaceSegment) -> date:
    if segment.created_at:
        return segment.created_at.date()
    return date.today()


def schedule_display_datetime_for_anchor(
    *,
    scheduled_date: date | None,
    scheduled_at: datetime | None = None,
    review_type: str | None,
    anchor_datetime: datetime | None,
    session: Session,
) -> datetime | None:
    if scheduled_at:
        return scheduled_at.replace(second=0, microsecond=0)
    if not scheduled_date:
        return None

    base_time = (
        anchor_datetime.time().replace(second=0, microsecond=0)
        if anchor_datetime
        else time(0, 0)
    )

    if review_type == "sleep":
        raw_sleep_time = get_config_value(session, "sleep_review_time") or "22:00"
        try:
            hour_str, minute_str = raw_sleep_time.split(":", 1)
            display_time = time(int(hour_str), int(minute_str))
        except (ValueError, TypeError):
            display_time = time(22, 0)
    elif review_type == "1h":
        display_time = (
            datetime.combine(scheduled_date, base_time) + timedelta(hours=1)
        ).time().replace(second=0, microsecond=0)
    else:
        display_time = base_time

    return datetime.combine(scheduled_date, display_time)


def palace_stage_completed_count(
    session: Session,
    palace: Palace,
    total: int,
) -> int:
    return infer_schedule_completed_stage_count(
        total=total,
        schedules=palace.review_schedules or [],
        mastered=palace.mastered,
    )


def segment_stage_progress(
    session: Session,
    segment: PalaceSegment,
) -> tuple[int, int, float]:
    intervals = get_algorithm_intervals(session)
    total = len(intervals)
    if total <= 0:
        return 0, 0, 0.0
    completed_count = infer_schedule_completed_stage_count(
        total=total,
        schedules=segment.review_schedules or [],
    )
    return total, completed_count, completed_count / total


def palace_stage_progress(
    session: Session,
    palace: Palace,
) -> tuple[int, int, float]:
    intervals = get_algorithm_intervals(session)
    if not intervals:
        intervals = ["1", "2", "4", "7", "15", "30", "60"]
    total = len(intervals)
    if total <= 0:
        return 0, 0, 0.0
    completed = palace_stage_completed_count(session, palace, total)
    if not (palace.review_schedules or []):
        review_logs = [
            log
            for log in (palace.review_logs or [])
            if getattr(log, "review_mode", "") == "review"
        ]
        completed = max(completed, min(len(review_logs), total))
    if palace.mastered and total > 0:
        completed = total
    return total, completed, completed / total


def review_stages_json(
    *,
    stage_labels: list[str],
    schedules: dict[int, Any],
    completed_count: int,
    scheduled_at_for: Callable[[Any | None], datetime | None],
) -> list[dict[str, Any]]:
    stages: list[dict[str, Any]] = []
    for index, label in enumerate(stage_labels):
        schedule = schedules.get(index)
        completed = index < completed_count
        stages.append(
            {
                "review_number": index,
                "label": label,
                "completed": completed,
                "completed_at": serialize_stage_datetime(
                    schedule.completed_at if completed and schedule else None
                ),
                "scheduled_at": serialize_stage_datetime(scheduled_at_for(schedule)),
            }
        )
    return stages


__all__ = [
    "get_segment_anchor_date",
    "palace_stage_completed_count",
    "palace_stage_progress",
    "review_stages_json",
    "schedule_display_datetime_for_anchor",
    "segment_stage_progress",
    "serialize_stage_datetime",
]
