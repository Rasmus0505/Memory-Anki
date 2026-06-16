from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    PalaceMiniPalace,
    PalaceMiniPalaceReviewSchedule,
)
from memory_anki.modules.palaces.application.mini_palace_nodes import (
    parse_mini_palace_node_uids,
)
from memory_anki.modules.reviews.application.schedule_policy import (
    ReviewScheduleDraft,
    ReviewSchedulePolicy,
    normalize_algorithm,
    schedule_display_datetime_for_policy,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    infer_completed_stage_count,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_intervals,
    get_config_value,
)

from .review_progress_datetime import parse_progress_datetime


def mini_palace_progress_state(
    session: Session,
    mini_palace: PalaceMiniPalace,
) -> tuple[int, int, float]:
    algorithm = resolve_mini_palace_algorithm(session, mini_palace)
    intervals = get_algorithm_intervals(session, algorithm)
    total = len(intervals)
    if total <= 0:
        return 0, 0, 0.0
    completed_count = infer_completed_stage_count(
        total=total,
        schedules=mini_palace.review_schedules or [],
    )
    return total, completed_count, completed_count / total


def resolve_mini_palace_algorithm(
    session: Session,
    mini_palace: PalaceMiniPalace,
    *,
    default_algorithm: str | None = None,
) -> str:
    return next(
        (
            normalize_algorithm(item.algorithm_used)
            for item in (mini_palace.review_schedules or [])
            if item.algorithm_used
        ),
        default_algorithm or normalize_algorithm(get_config_value(session, "default_algorithm")),
    )


def resolve_mini_palace_anchor_date(mini_palace: PalaceMiniPalace) -> date:
    for schedule in mini_palace.review_schedules or []:
        if schedule.anchor_date:
            return schedule.anchor_date
    if mini_palace.created_at:
        return mini_palace.created_at.date()
    if mini_palace.palace and mini_palace.palace.created_at:
        return mini_palace.palace.created_at.date()
    return date.today()


def resolve_mini_palace_anchor_datetime(mini_palace: PalaceMiniPalace) -> datetime | None:
    return (
        mini_palace.created_at
        or (mini_palace.palace.created_at if mini_palace.palace else None)
        or mini_palace.updated_at
    )


def mini_palace_is_empty(mini_palace: PalaceMiniPalace) -> bool:
    return len(parse_mini_palace_node_uids(mini_palace.node_uids_json)) == 0


def serialize_stage_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(second=0, microsecond=0).isoformat(timespec="minutes")


def copy_mini_schedule(
    mini_palace: PalaceMiniPalace,
    draft: ReviewScheduleDraft,
    *,
    completed: bool,
    completed_at: datetime | None,
) -> PalaceMiniPalaceReviewSchedule:
    return PalaceMiniPalaceReviewSchedule(
        palace_mini_palace_id=mini_palace.id,
        scheduled_date=draft.scheduled_date,
        scheduled_at=draft.scheduled_at,
        interval_days=draft.interval_days,
        algorithm_used=draft.algorithm_used,
        completed=completed,
        completed_at=completed_at,
        review_number=draft.review_number,
        review_type=draft.review_type,
        anchor_date=draft.anchor_date,
    )


def create_mini_schedule_from_draft(
    session: Session,
    *,
    mini_palace: PalaceMiniPalace,
    draft: ReviewScheduleDraft | None,
    completed: bool,
    completed_at: datetime | None,
) -> PalaceMiniPalaceReviewSchedule | None:
    if draft is None:
        return None
    schedule = copy_mini_schedule(
        mini_palace,
        draft,
        completed=completed,
        completed_at=completed_at,
    )
    session.add(schedule)
    return schedule


def coerce_stage_completed_at(
    value: datetime | None,
    *,
    fallback: datetime | None = None,
) -> datetime:
    target = value or fallback or datetime.now()
    return target.replace(second=0, microsecond=0)


def collect_completed_stage_times(
    *,
    schedules: list[Any],
    completed_count: int,
) -> dict[int, datetime]:
    completed_at_by_stage: dict[int, datetime] = {}
    for review_number in range(completed_count):
        matching = [
            schedule
            for schedule in schedules
            if int(schedule.review_number) == review_number
        ]
        completed_schedule = next(
            (schedule for schedule in matching if getattr(schedule, "completed", False)),
            None,
        )
        if completed_schedule is None:
            continue
        completed_at_by_stage[review_number] = coerce_stage_completed_at(
            getattr(completed_schedule, "completed_at", None)
        )
    return completed_at_by_stage


def target_pending_review_numbers(
    *,
    completed_count: int,
    total: int,
    initial_slot_count: int,
) -> list[int]:
    if completed_count >= total:
        return []
    if completed_count < initial_slot_count:
        return list(range(completed_count, min(initial_slot_count, total)))
    return [completed_count]


def resolve_effective_stage_anchor_at(
    *,
    use_anchor_mode: bool,
    actual_completed_at: datetime,
    scheduled_display_at: datetime | None,
) -> datetime:
    normalized_completed_at = coerce_stage_completed_at(actual_completed_at)
    if (
        use_anchor_mode
        and scheduled_display_at is not None
        and normalized_completed_at < scheduled_display_at
        and normalized_completed_at.date() == scheduled_display_at.date()
    ):
        return scheduled_display_at.replace(second=0, microsecond=0)
    return normalized_completed_at


def existing_mini_schedule_display_at(
    schedules: list[Any],
    review_number: int,
    *,
    policy: ReviewSchedulePolicy,
    mini_palace: PalaceMiniPalace,
) -> datetime | None:
    existing_schedule = next(
        (
            schedule
            for schedule in schedules
            if int(getattr(schedule, "review_number", -1)) == review_number
        ),
        None,
    )
    if existing_schedule is None or getattr(existing_schedule, "scheduled_at", None) is None:
        return None
    return schedule_display_datetime_for_policy(
        policy,
        scheduled_date=getattr(existing_schedule, "scheduled_date", None),
        scheduled_at=getattr(existing_schedule, "scheduled_at", None),
        review_type=getattr(existing_schedule, "review_type", None),
        anchor_datetime=resolve_mini_palace_anchor_datetime(mini_palace),
    )


__all__ = [
    "collect_completed_stage_times",
    "coerce_stage_completed_at",
    "copy_mini_schedule",
    "create_mini_schedule_from_draft",
    "existing_mini_schedule_display_at",
    "mini_palace_is_empty",
    "mini_palace_progress_state",
    "parse_progress_datetime",
    "resolve_effective_stage_anchor_at",
    "resolve_mini_palace_algorithm",
    "resolve_mini_palace_anchor_date",
    "resolve_mini_palace_anchor_datetime",
    "serialize_stage_datetime",
    "target_pending_review_numbers",
]
