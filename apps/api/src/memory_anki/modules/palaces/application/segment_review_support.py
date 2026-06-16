from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, PalaceSegment
from memory_anki.modules.reviews.application.schedule_policy import (
    resolve_interval_from_base_date,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    infer_completed_stage_count as infer_schedule_completed_stage_count,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    palace_algorithm as resolve_palace_review_algorithm,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    segment_algorithm as resolve_segment_review_algorithm,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_intervals,
    get_config_value,
    normalize_algorithm,
)


def default_segment_algorithm(session: Session) -> str:
    return normalize_algorithm(get_config_value(session, "default_algorithm"))


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


def segment_review_algorithm(
    session: Session,
    segment: PalaceSegment,
    *,
    default_algorithm: str | None = None,
) -> str:
    return resolve_segment_review_algorithm(
        session,
        segment,
        default_algorithm=default_algorithm or default_segment_algorithm(session),
    )


def palace_review_algorithm(
    session: Session,
    palace: Palace,
    *,
    default_algorithm: str | None = None,
) -> str:
    return resolve_palace_review_algorithm(
        session,
        palace,
        default_algorithm=default_algorithm or default_segment_algorithm(session),
    )


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
    algorithm = segment_review_algorithm(session, segment)
    intervals = get_algorithm_intervals(session, algorithm)
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
    algorithm = palace_review_algorithm(session, palace)
    intervals = get_algorithm_intervals(session, algorithm)
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


def serialize_stage_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(second=0, microsecond=0).isoformat(timespec="minutes")


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
    "default_segment_algorithm",
    "get_segment_anchor_date",
    "palace_review_algorithm",
    "palace_stage_completed_count",
    "palace_stage_progress",
    "review_stages_json",
    "schedule_display_datetime_for_anchor",
    "segment_review_algorithm",
    "segment_stage_progress",
    "serialize_stage_datetime",
]
