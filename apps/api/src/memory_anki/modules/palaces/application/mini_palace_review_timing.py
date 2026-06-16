from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    PalaceMiniPalace,
    PalaceMiniPalaceReviewSchedule,
)
from memory_anki.modules.reviews.application.schedule_policy import (
    build_review_schedule_draft,
    get_algorithm_intervals_for_policy,
    get_initial_same_day_slot_count_for_policy,
    load_review_schedule_policy,
    schedule_display_datetime_for_policy,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_intervals,
)

from .mini_palace_review_support import (
    create_mini_schedule_from_draft,
    mini_palace_is_empty,
    mini_palace_progress_state,
    resolve_mini_palace_algorithm,
    resolve_mini_palace_anchor_date,
    resolve_mini_palace_anchor_datetime,
    serialize_stage_datetime,
)


def ensure_mini_palace_schedule_model(
    session: Session,
    mini_palace: PalaceMiniPalace,
) -> bool:
    schedules = sorted(
        list(mini_palace.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )
    if schedules or mini_palace_is_empty(mini_palace):
        return False
    policy = load_review_schedule_policy(session)
    algorithm = resolve_mini_palace_algorithm(
        session,
        mini_palace,
        default_algorithm=policy.default_algorithm,
    )
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    if not intervals:
        return False
    anchor = resolve_mini_palace_anchor_date(mini_palace)
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
        create_mini_schedule_from_draft(
            session,
            mini_palace=mini_palace,
            draft=draft,
            completed=False,
            completed_at=None,
        )
    session.flush()
    return True


def get_mini_palace_schedule_display_datetime(
    session: Session,
    mini_palace: PalaceMiniPalace,
    schedule: PalaceMiniPalaceReviewSchedule | None,
) -> datetime | None:
    if schedule is None:
        return None
    return schedule_display_datetime_for_policy(
        load_review_schedule_policy(session),
        scheduled_date=schedule.scheduled_date,
        scheduled_at=schedule.scheduled_at,
        review_type=schedule.review_type,
        anchor_datetime=resolve_mini_palace_anchor_datetime(mini_palace),
    )


def is_mini_palace_schedule_due(
    session: Session,
    mini_palace: PalaceMiniPalace,
    schedule: PalaceMiniPalaceReviewSchedule | None,
    *,
    now: datetime | None = None,
) -> bool:
    if schedule is None or schedule.completed or mini_palace_is_empty(mini_palace):
        return False
    due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at <= current


def is_mini_palace_schedule_overdue(
    session: Session,
    mini_palace: PalaceMiniPalace,
    schedule: PalaceMiniPalaceReviewSchedule | None,
    *,
    now: datetime | None = None,
) -> bool:
    if schedule is None or schedule.completed or mini_palace_is_empty(mini_palace):
        return False
    due_at = get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at.date() < current.date() and due_at <= current


def build_mini_palace_timing(
    session: Session,
    mini_palace: PalaceMiniPalace,
) -> dict[str, Any]:
    if mini_palace_is_empty(mini_palace):
        return {
            "next_review_at": None,
            "has_due_review": False,
            "current_review_schedule_id": None,
            "current_review_type": None,
        }
    pending_schedules = sorted(
        [schedule for schedule in (mini_palace.review_schedules or []) if not schedule.completed],
        key=lambda schedule: (schedule.review_number, schedule.id),
    )
    next_schedule = pending_schedules[0] if pending_schedules else None
    if next_schedule is not None:
        next_review_at = get_mini_palace_schedule_display_datetime(
            session,
            mini_palace,
            next_schedule,
        )
        return {
            "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
            "has_due_review": is_mini_palace_schedule_due(session, mini_palace, next_schedule),
            "current_review_schedule_id": next_schedule.id,
            "current_review_type": next_schedule.review_type,
        }

    algorithm = resolve_mini_palace_algorithm(session, mini_palace)
    intervals = get_algorithm_intervals(session, algorithm) or ["1", "2", "4", "7", "15", "30", "60"]
    total = len(intervals)
    _, completed, _ = mini_palace_progress_state(session, mini_palace)
    if completed >= total:
        return {
            "next_review_at": None,
            "has_due_review": False,
            "current_review_schedule_id": None,
            "current_review_type": None,
        }
    policy = load_review_schedule_policy(session)
    anchor = resolve_mini_palace_anchor_date(mini_palace)
    fallback_draft = build_review_schedule_draft(
        policy,
        review_number=completed,
        algorithm=algorithm,
        base_date=anchor,
        anchor_date=anchor,
        completed=False,
    )
    if fallback_draft is None:
        return {
            "next_review_at": None,
            "has_due_review": False,
            "current_review_schedule_id": None,
            "current_review_type": None,
        }
    next_review_at = schedule_display_datetime_for_policy(
        policy,
        scheduled_date=fallback_draft.scheduled_date,
        scheduled_at=fallback_draft.scheduled_at,
        review_type=fallback_draft.review_type,
        anchor_datetime=resolve_mini_palace_anchor_datetime(mini_palace),
    )
    has_due_review = bool(next_review_at and next_review_at <= datetime.now())
    return {
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": has_due_review,
        "current_review_schedule_id": None,
        "current_review_type": fallback_draft.review_type,
    }


def mini_review_stages_json(
    session: Session,
    mini_palace: PalaceMiniPalace,
    stage_labels: list[str],
) -> list[dict[str, Any]]:
    schedules = {
        schedule.review_number: schedule
        for schedule in sorted(mini_palace.review_schedules or [], key=lambda item: item.id)
    }
    _, completed_count, _ = mini_palace_progress_state(session, mini_palace)
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
                "scheduled_at": serialize_stage_datetime(
                    get_mini_palace_schedule_display_datetime(session, mini_palace, schedule)
                ),
            }
        )
    return stages


__all__ = [
    "build_mini_palace_timing",
    "ensure_mini_palace_schedule_model",
    "get_mini_palace_schedule_display_datetime",
    "is_mini_palace_schedule_due",
    "is_mini_palace_schedule_overdue",
    "mini_review_stages_json",
]
