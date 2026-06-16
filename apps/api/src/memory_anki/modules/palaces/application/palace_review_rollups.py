from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, PalaceSegmentReviewSchedule, ReviewSchedule
from memory_anki.modules.palaces.application.mini_palace_service import (
    ensure_mini_palace_schedule_model,
    get_mini_palace_schedule_display_datetime,
    is_mini_palace_schedule_due,
)
from memory_anki.modules.palaces.application.palace_review_modes import (
    palace_uses_mini_only_review,
)
from memory_anki.modules.palaces.application.segment_review_service import (
    get_segment_schedule_display_datetime,
    is_segment_schedule_due,
)
from memory_anki.modules.reviews.application.schedule_service import (
    is_schedule_due,
    schedule_display_datetime,
)


def _next_pending_palace_schedule(palace: Palace) -> ReviewSchedule | None:
    pending_schedules = [schedule for schedule in (palace.review_schedules or []) if not schedule.completed]
    if not pending_schedules:
        return None
    return min(pending_schedules, key=lambda schedule: (schedule.review_number, schedule.id))


def _next_pending_segment_schedule(palace: Palace) -> tuple[Any, PalaceSegmentReviewSchedule] | None:
    candidates: list[tuple[Any, PalaceSegmentReviewSchedule]] = []
    for segment in list(getattr(palace, "segments", []) or []):
        next_schedule = next(
            (
                schedule
                for schedule in sorted(
                    getattr(segment, "review_schedules", None) or [],
                    key=lambda schedule: (schedule.review_number, schedule.id),
                )
                if not schedule.completed
            ),
            None,
        )
        if next_schedule is not None:
            candidates.append((segment, next_schedule))
    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[1].review_number, item[1].id))


def _review_datetime_is_later_today(dt: Any, now: datetime) -> bool:
    if not dt:
        return False
    if dt <= now:
        return False
    return dt.date() == now.date()


def _next_pending_mini_schedule_for_item(mini_palace: Any) -> Any | None:
    pending = sorted(
        [schedule for schedule in (mini_palace.review_schedules or []) if not schedule.completed],
        key=lambda item: (item.review_number, item.id),
    )
    return pending[0] if pending else None


def _next_pending_mini_schedule(session: Session, palace: Palace) -> tuple[Any, Any] | None:
    candidates: list[tuple[Any, Any]] = []
    for mini_palace in list(getattr(palace, "mini_palaces", []) or []):
        ensure_mini_palace_schedule_model(session, mini_palace)
        next_schedule = _next_pending_mini_schedule_for_item(mini_palace)
        if next_schedule is None:
            continue
        candidates.append((mini_palace, next_schedule))
    if not candidates:
        return None
    return min(candidates, key=lambda item: (item[1].review_number, item[1].id))


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
    suppress_main_review = palace_uses_mini_only_review(palace)

    if not suppress_main_review:
        if palace_has_due_review(session, palace, now=current, include_mini_palaces=False):
            due_now_count += 1
        elif palace_has_due_later_today(session, palace, now=current, include_mini_palaces=False):
            due_later_today_count += 1

    for mini_palace in list(getattr(palace, "mini_palaces", []) or []):
        ensure_mini_palace_schedule_model(session, mini_palace)
        if bool(getattr(mini_palace, "needs_practice", False)):
            needs_practice_count += 1
        next_schedule = _next_pending_mini_schedule_for_item(mini_palace)
        if next_schedule is None:
            continue
        due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, next_schedule)
        if is_mini_palace_schedule_due(session, mini_palace, next_schedule, now=current):
            due_now_count += 1
        elif _review_datetime_is_later_today(due_at, current):
            due_later_today_count += 1

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
    include_mini_palaces: bool = True,
) -> bool:
    current = now or datetime.now()
    if not palace_uses_mini_only_review(palace):
        next_schedule = _next_pending_palace_schedule(palace)
        if next_schedule and is_schedule_due(next_schedule, palace, session, now=current):
            return True

        next_segment = _next_pending_segment_schedule(palace)
        if next_segment is not None:
            segment, schedule = next_segment
            if is_segment_schedule_due(session, segment, schedule, now=current):
                return True

    if not include_mini_palaces:
        return False

    next_mini = _next_pending_mini_schedule(session, palace)
    if next_mini is None:
        return False
    mini_palace, schedule = next_mini
    ensure_mini_palace_schedule_model(session, mini_palace)
    return is_mini_palace_schedule_due(session, mini_palace, schedule, now=current)


def palace_has_due_later_today(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
    include_mini_palaces: bool = True,
) -> bool:
    current = now or datetime.now()
    if not palace_uses_mini_only_review(palace):
        next_schedule = _next_pending_palace_schedule(palace)
        due_at = schedule_display_datetime(next_schedule, palace, session) if next_schedule else None
        if _review_datetime_is_later_today(due_at, current):
            return True

        next_segment = _next_pending_segment_schedule(palace)
        if next_segment is not None:
            segment, schedule = next_segment
            due_at = get_segment_schedule_display_datetime(session, segment, schedule)
            if _review_datetime_is_later_today(due_at, current):
                return True

    if not include_mini_palaces:
        return False

    next_mini = _next_pending_mini_schedule(session, palace)
    if next_mini is None:
        return False
    mini_palace, schedule = next_mini
    ensure_mini_palace_schedule_model(session, mini_palace)
    due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
    return _review_datetime_is_later_today(due_at, current)


__all__ = [
    "_next_pending_mini_schedule",
    "_next_pending_mini_schedule_for_item",
    "_next_pending_palace_schedule",
    "_next_pending_segment_schedule",
    "_review_datetime_is_later_today",
    "count_palace_review_units",
    "palace_has_due_later_today",
    "palace_has_due_review",
]
