"""Segment helpers without legacy Ebbinghaus stage schedules."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceSegment
from memory_anki.modules.reviews.api import get_palace_memory_projection

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
    del review_type, anchor_datetime, session
    if scheduled_at:
        return scheduled_at.replace(second=0, microsecond=0)
    if not scheduled_date:
        return None
    return datetime.combine(scheduled_date, datetime.min.time())


def palace_stage_completed_count(
    session: Session,
    palace: Palace,
    total: int,
) -> int:
    del total
    try:
        projection = get_palace_memory_projection(session, palace.id)
        return int(projection.get("mastery_percent") or 0)
    except ValueError:
        return 0


def segment_stage_progress(
    session: Session,
    segment: PalaceSegment,
) -> tuple[int, int, float]:
    del session, segment
    return 0, 0, 0.0


def palace_stage_progress(
    session: Session,
    palace: Palace,
) -> tuple[int, int, float]:
    try:
        projection = get_palace_memory_projection(session, palace.id)
        percent = int(projection.get("mastery_percent") or 0)
        return 100, percent, percent / 100.0
    except ValueError:
        return 0, 0, 0.0


def review_stages_json(
    *,
    stage_labels: list[str],
    schedules: dict[int, Any],
    completed_count: int,
    scheduled_at_for,
) -> list[dict[str, Any]]:
    del stage_labels, schedules, completed_count, scheduled_at_for
    return []


__all__ = [
    "get_segment_anchor_date",
    "palace_stage_completed_count",
    "palace_stage_progress",
    "review_stages_json",
    "schedule_display_datetime_for_anchor",
    "segment_stage_progress",
    "serialize_stage_datetime",
]
