from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewSchedule
from memory_anki.modules.reviews.application.schedule_service import (
    is_schedule_due,
    schedule_display_datetime,
)


def _next_pending_palace_schedule(palace: Palace) -> ReviewSchedule | None:
    pending_schedules = [schedule for schedule in (palace.review_schedules or []) if not schedule.completed]
    if not pending_schedules:
        return None
    return min(pending_schedules, key=lambda schedule: (schedule.review_number, schedule.id))


def _review_datetime_is_later_today(dt: Any, now: datetime) -> bool:
    if not dt:
        return False
    if dt <= now:
        return False
    return dt.date() == now.date()


def count_palace_review_units(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    current = now or datetime.now()
    due_now_count = 0
    due_later_today_count = 0
    needs_practice_count = 1 if bool(getattr(palace, "needs_practice", False)) else 0

    if palace_has_due_review(session, palace, now=current):
        due_now_count += 1
    elif palace_has_due_later_today(session, palace, now=current):
        due_later_today_count += 1

    for mini_palace in list(getattr(palace, "mini_palaces", []) or []):
        if bool(getattr(mini_palace, "needs_practice", False)):
            needs_practice_count += 1

    return {
        "due_now_count": due_now_count,
        "due_later_today_count": due_later_today_count,
        "needs_practice_count": needs_practice_count,
    }


def palace_has_due_review(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> bool:
    current = now or datetime.now()
    next_schedule = _next_pending_palace_schedule(palace)
    return bool(next_schedule and is_schedule_due(next_schedule, palace, session, now=current))


def palace_has_due_later_today(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> bool:
    current = now or datetime.now()
    next_schedule = _next_pending_palace_schedule(palace)
    due_at = schedule_display_datetime(next_schedule, palace, session) if next_schedule else None
    return _review_datetime_is_later_today(due_at, current)


__all__ = [
    "_next_pending_palace_schedule",
    "_review_datetime_is_later_today",
    "count_palace_review_units",
    "palace_has_due_later_today",
    "palace_has_due_review",
]
