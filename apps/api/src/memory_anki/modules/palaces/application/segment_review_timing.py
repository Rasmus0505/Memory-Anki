from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceSegment,
    PalaceSegmentReviewSchedule,
)
from memory_anki.modules.reviews.application.schedule_policy import (
    build_review_schedule_draft,
    get_algorithm_intervals_for_policy,
    get_initial_same_day_slot_count_for_policy,
    load_review_schedule_policy,
    resolve_interval_from_base_date,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_intervals,
    is_schedule_due,
    schedule_display_datetime,
)

from .segment_review_support import (
    get_segment_anchor_date,
    palace_review_algorithm,
    schedule_display_datetime_for_anchor,
    segment_review_algorithm,
)


def get_segment_schedule_display_datetime(
    session: Session,
    segment: PalaceSegment,
    schedule: PalaceSegmentReviewSchedule | None,
) -> datetime | None:
    if schedule is None:
        return None
    return schedule_display_datetime_for_anchor(
        scheduled_date=schedule.scheduled_date,
        scheduled_at=schedule.scheduled_at,
        review_type=schedule.review_type,
        anchor_datetime=(
            segment.created_at
            or (segment.palace.created_at if segment.palace else None)
        ),
        session=session,
    )


def is_segment_schedule_due(
    session: Session,
    segment: PalaceSegment,
    schedule: PalaceSegmentReviewSchedule | None,
    *,
    now: datetime | None = None,
) -> bool:
    if schedule is None or schedule.completed:
        return False
    due_at = get_segment_schedule_display_datetime(session, segment, schedule)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at <= current


def is_segment_schedule_overdue(
    session: Session,
    segment: PalaceSegment,
    schedule: PalaceSegmentReviewSchedule | None,
    *,
    now: datetime | None = None,
) -> bool:
    if schedule is None or schedule.completed:
        return False
    due_at = get_segment_schedule_display_datetime(session, segment, schedule)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at.date() < current.date() and due_at <= current


def build_virtual_default_segment_timing(
    palace: Palace,
    *,
    session: Session,
    review_stage_total: int,
    review_stage_completed: int,
) -> dict[str, Any]:
    pending_schedules = sorted(
        [schedule for schedule in (palace.review_schedules or []) if not schedule.completed],
        key=lambda schedule: (schedule.review_number, schedule.id),
    )
    next_schedule = pending_schedules[0] if pending_schedules else None
    if next_schedule is not None:
        next_review_at = schedule_display_datetime(next_schedule, palace, session)
        has_due_review = bool(next_review_at and is_schedule_due(next_schedule, palace, session))
        return {
            "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
            "has_due_review": has_due_review,
            "current_review_schedule_id": next_schedule.id,
            "current_review_type": next_schedule.review_type,
        }

    current_algorithm = palace_review_algorithm(session, palace)
    intervals = get_algorithm_intervals(session, current_algorithm) or ["1", "2", "4", "7", "15", "30", "60"]
    total = len(intervals)
    completed = max(0, min(review_stage_completed, total))
    if completed >= total:
        return {
            "next_review_at": None,
            "has_due_review": False,
            "current_review_schedule_id": None,
            "current_review_type": None,
        }

    next_interval_value = intervals[completed]
    _, scheduled_date, review_type, _ = resolve_interval_from_base_date(
        next_interval_value,
        (palace.created_at.date() if palace.created_at else date.today()),
        current_algorithm,
    )
    next_review_at = schedule_display_datetime_for_anchor(
        scheduled_date=scheduled_date,
        scheduled_at=None,
        review_type=review_type,
        anchor_datetime=palace.created_at or palace.updated_at,
        session=session,
    )
    has_due_review = bool(next_review_at and next_review_at <= datetime.now())
    return {
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": has_due_review,
        "current_review_schedule_id": None,
        "current_review_type": review_type,
    }


def ensure_segment_schedule_model(session: Session, segment: PalaceSegment) -> None:
    schedules = sorted(
        list(segment.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )
    if schedules:
        return
    policy = load_review_schedule_policy(session)
    algorithm = segment_review_algorithm(
        session,
        segment,
        default_algorithm=policy.default_algorithm,
    )
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    if not intervals:
        return
    anchor = get_segment_anchor_date(segment)
    slot_count = max(1, get_initial_same_day_slot_count_for_policy(policy, algorithm))
    for review_number in range(min(slot_count, len(intervals))):
        draft = build_review_schedule_draft(
            policy,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor,
            anchor_date=anchor,
            completed=False,
        )
        if draft is None:
            continue
        session.add(
            PalaceSegmentReviewSchedule(
                palace_segment_id=segment.id,
                scheduled_date=draft.scheduled_date,
                interval_days=draft.interval_days,
                algorithm_used=draft.algorithm_used,
                completed=draft.completed,
                completed_at=draft.completed_at,
                review_number=draft.review_number,
                review_type=draft.review_type,
                anchor_date=draft.anchor_date,
                scheduled_at=draft.scheduled_at,
            )
        )
    session.flush()


__all__ = [
    "build_virtual_default_segment_timing",
    "ensure_segment_schedule_model",
    "get_segment_schedule_display_datetime",
    "is_segment_schedule_due",
    "is_segment_schedule_overdue",
]
