from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceSegment,
    PalaceSegmentReviewSchedule,
    ReviewSchedule,
)

from .schedule_policy import (
    ReviewScheduleDraft,
    ReviewSchedulePolicy,
    build_review_schedule_draft,
    create_review_schedule_from_draft,
    get_algorithm_intervals_for_policy,
    get_initial_same_day_slot_count_for_policy,
    load_review_schedule_policy,
    normalize_algorithm,
    schedule_display_datetime_for_policy,
)


def infer_completed_stage_count(
    *,
    total: int,
    schedules: list[Any],
    mastered: bool = False,
    fallback_completed_count: int | None = None,
) -> int:
    if total <= 0:
        return 0

    completed_numbers = {
        int(schedule.review_number)
        for schedule in schedules
        if getattr(schedule, "completed", False)
    }
    pending_numbers = sorted(
        {
            int(schedule.review_number)
            for schedule in schedules
            if not getattr(schedule, "completed", False)
        }
    )

    completed_count = 0
    while completed_count < total and completed_count in completed_numbers:
        completed_count += 1

    if pending_numbers:
        completed_count = max(completed_count, min(pending_numbers[0], total))
    if fallback_completed_count is not None:
        completed_count = max(completed_count, min(fallback_completed_count, total))
    if mastered and total > 0:
        completed_count = total

    return max(0, min(completed_count, total))


def segment_algorithm(
    session: Session,
    segment: PalaceSegment,
    *,
    default_algorithm: str | None = None,
) -> str:
    return next(
        (
            normalize_algorithm(item.algorithm_used)
            for item in (segment.review_schedules or [])
            if item.algorithm_used
        ),
        default_algorithm or _default_algorithm(session),
    )


def palace_algorithm(
    session: Session,
    palace: Palace,
    *,
    default_algorithm: str | None = None,
) -> str:
    return next(
        (
            normalize_algorithm(item.algorithm_used)
            for item in (palace.review_schedules or [])
            if item.algorithm_used
        ),
        default_algorithm or _default_algorithm(session),
    )


def palace_anchor_date(palace: Palace) -> date:
    for schedule in palace.review_schedules or []:
        if schedule.anchor_date:
            return schedule.anchor_date
    if palace.created_at:
        return palace.created_at.date()
    return date.today()


def rebuild_palace_review_schedules(
    session: Session,
    palace: Palace,
    *,
    completed_count: int,
    completed_review_number: int | None = None,
    completed_at: datetime | None = None,
    fallback_completed_count: int | None = None,
    preserve_existing_progress: bool = True,
    algorithm_override: str | None = None,
) -> None:
    policy = load_review_schedule_policy(session)
    algorithm = normalize_algorithm(
        algorithm_override
        or palace_algorithm(session, palace, default_algorithm=policy.default_algorithm)
    )
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    total = len(intervals)
    safe_completed_count = max(0, min(completed_count, total))
    anchor = palace_anchor_date(palace)
    initial_slot_count = max(1, get_initial_same_day_slot_count_for_policy(policy, algorithm))
    existing_schedules = sorted(
        list(palace.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )

    if preserve_existing_progress and fallback_completed_count is None:
        fallback_completed_count = infer_completed_stage_count(
            total=total,
            schedules=existing_schedules,
            mastered=palace.mastered,
        )

    effective_completed_count = safe_completed_count
    if preserve_existing_progress and fallback_completed_count is not None:
        effective_completed_count = max(
            safe_completed_count,
            min(fallback_completed_count, total),
        )
    completed_at_by_stage = _collect_completed_stage_times(
        schedules=existing_schedules,
        completed_count=effective_completed_count,
    )

    if (
        completed_review_number is not None
        and 0 <= completed_review_number < effective_completed_count
        and completed_at is not None
    ):
        completed_at_by_stage[completed_review_number] = _coerce_stage_completed_at(completed_at)
    elif completed_at is not None and effective_completed_count > 0:
        normalized_completed_at = _coerce_stage_completed_at(completed_at)
        completed_at_by_stage[effective_completed_count - 1] = normalized_completed_at
        for review_number in range(effective_completed_count):
            completed_at_by_stage.setdefault(review_number, normalized_completed_at)

    session.query(ReviewSchedule).filter_by(palace_id=palace.id).delete(
        synchronize_session=False
    )
    session.flush()
    for schedule in existing_schedules:
        if sqlalchemy_inspect(schedule).session is session:
            session.expunge(schedule)
    session.expire(palace, ["review_schedules"])

    previous_anchor_at: datetime | None = None
    for review_number in range(effective_completed_count):
        stage_completed_at = _coerce_stage_completed_at(
            completed_at_by_stage.get(review_number),
            fallback=previous_anchor_at,
        )
        base_datetime = previous_anchor_at if review_number >= initial_slot_count else None
        draft = build_review_schedule_draft(
            policy,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=True,
            completed_at=stage_completed_at,
        )
        _create_palace_schedule_from_draft(
            session,
            palace_id=palace.id,
            draft=draft,
        )
        scheduled_display_at = _existing_schedule_display_at(
            existing_schedules,
            review_number,
            policy=policy,
            palace=palace,
        ) or (
            schedule_display_datetime_for_policy(
                policy,
                scheduled_date=draft.scheduled_date,
                scheduled_at=draft.scheduled_at,
                review_type=draft.review_type,
                anchor_datetime=palace.created_at or palace.updated_at,
            )
            if draft is not None
            else None
        )
        previous_anchor_at = _resolve_effective_stage_anchor_at(
            use_anchor_mode=policy.early_review_anchor,
            actual_completed_at=stage_completed_at,
            scheduled_display_at=scheduled_display_at,
        )

    palace.mastered = effective_completed_count >= total and total > 0
    if not palace.mastered:
        for review_number in _target_pending_review_numbers(
            completed_count=effective_completed_count,
            total=total,
            initial_slot_count=initial_slot_count,
        ):
            base_datetime = previous_anchor_at if review_number >= initial_slot_count else None
            draft = build_review_schedule_draft(
                policy,
                review_number=review_number,
                algorithm=algorithm,
                base_date=anchor if base_datetime is None else base_datetime.date(),
                anchor_date=anchor,
                base_datetime=base_datetime,
                completed=False,
            )
            _create_palace_schedule_from_draft(
                session,
                palace_id=palace.id,
                draft=draft,
            )

    session.flush()


def rebuild_segment_review_schedules(
    session: Session,
    segment: PalaceSegment,
    *,
    completed_count: int,
    completed_review_number: int | None = None,
    completed_at: datetime | None = None,
    algorithm_override: str | None = None,
) -> None:
    policy = load_review_schedule_policy(session)
    algorithm = normalize_algorithm(
        algorithm_override
        or segment_algorithm(session, segment, default_algorithm=policy.default_algorithm)
    )
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    total = len(intervals)
    safe_completed_count = max(0, min(completed_count, total))
    anchor = _segment_anchor_date(segment)
    initial_slot_count = max(1, get_initial_same_day_slot_count_for_policy(policy, algorithm))
    existing_schedules = sorted(
        list(segment.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )
    completed_at_by_stage = _collect_completed_stage_times(
        schedules=existing_schedules,
        completed_count=safe_completed_count,
    )

    if (
        completed_review_number is not None
        and 0 <= completed_review_number < safe_completed_count
        and completed_at is not None
    ):
        completed_at_by_stage[completed_review_number] = _coerce_stage_completed_at(completed_at)
    elif completed_at is not None and safe_completed_count > 0:
        normalized_completed_at = _coerce_stage_completed_at(completed_at)
        completed_at_by_stage[safe_completed_count - 1] = normalized_completed_at
        for review_number in range(safe_completed_count):
            completed_at_by_stage.setdefault(review_number, normalized_completed_at)

    session.query(PalaceSegmentReviewSchedule).filter_by(
        palace_segment_id=segment.id
    ).delete(synchronize_session=False)
    session.flush()
    for schedule in existing_schedules:
        if sqlalchemy_inspect(schedule).session is session:
            session.expunge(schedule)
    session.expire(segment, ["review_schedules"])

    previous_anchor_at: datetime | None = None
    for review_number in range(safe_completed_count):
        stage_completed_at = _coerce_stage_completed_at(
            completed_at_by_stage.get(review_number),
            fallback=previous_anchor_at,
        )
        base_datetime = previous_anchor_at if review_number >= initial_slot_count else None
        draft = build_review_schedule_draft(
            policy,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=True,
            completed_at=stage_completed_at,
        )
        _create_segment_schedule_from_draft(
            session,
            segment=segment,
            draft=draft,
            completed=True,
            completed_at=stage_completed_at,
        )
        scheduled_display_at = _existing_schedule_display_at(
            existing_schedules,
            review_number,
            policy=policy,
            segment=segment,
        ) or (
            schedule_display_datetime_for_policy(
                policy,
                scheduled_date=draft.scheduled_date,
                scheduled_at=draft.scheduled_at,
                review_type=draft.review_type,
                anchor_datetime=(
                    segment.created_at
                    or (segment.palace.created_at if segment.palace else None)
                ),
            )
            if draft is not None
            else None
        )
        previous_anchor_at = _resolve_effective_stage_anchor_at(
            use_anchor_mode=policy.early_review_anchor,
            actual_completed_at=stage_completed_at,
            scheduled_display_at=scheduled_display_at,
        )

    for review_number in _target_pending_review_numbers(
        completed_count=safe_completed_count,
        total=total,
        initial_slot_count=initial_slot_count,
    ):
        base_datetime = previous_anchor_at if review_number >= initial_slot_count else None
        draft = build_review_schedule_draft(
            policy,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=False,
        )
        _create_segment_schedule_from_draft(
            session,
            segment=segment,
            draft=draft,
            completed=False,
            completed_at=None,
        )
    session.flush()


def rebuild_all_pending_review_schedules(
    session: Session,
    *,
    algorithm_override: str | None = None,
) -> dict[str, Any]:
    palace_count = 0
    segment_count = 0
    policy = load_review_schedule_policy(session)

    palaces = session.query(Palace).all()
    for palace in palaces:
        algorithm = normalize_algorithm(
            algorithm_override
            or palace_algorithm(
                session,
                palace,
                default_algorithm=policy.default_algorithm,
            )
        )
        total = len(get_algorithm_intervals_for_policy(policy, algorithm))
        review_logs = [
            log
            for log in (palace.review_logs or [])
            if getattr(log, "review_mode", "") == "review"
        ]
        schedule_completed_count = infer_completed_stage_count(
            total=total,
            schedules=palace.review_schedules or [],
            mastered=palace.mastered,
        )
        fallback_completed_count = (
            schedule_completed_count
            if palace.review_schedules
            else max(len(review_logs), schedule_completed_count)
        )
        rebuild_palace_review_schedules(
            session,
            palace,
            completed_count=fallback_completed_count,
            fallback_completed_count=fallback_completed_count,
            algorithm_override=algorithm,
        )
        palace_count += 1

    segments = session.query(PalaceSegment).all()
    for segment in segments:
        algorithm = normalize_algorithm(
            algorithm_override
            or segment_algorithm(
                session,
                segment,
                default_algorithm=policy.default_algorithm,
            )
        )
        total = len(get_algorithm_intervals_for_policy(policy, algorithm))
        schedule_completed_count = infer_completed_stage_count(
            total=total,
            schedules=segment.review_schedules or [],
        )
        fallback_completed_count = (
            schedule_completed_count
            if segment.review_schedules
            else max(len(segment.review_logs or []), schedule_completed_count)
        )
        rebuild_segment_review_schedules(
            session,
            segment,
            completed_count=fallback_completed_count,
            algorithm_override=algorithm,
        )
        segment_count += 1

    session.commit()
    return {
        "palace_count": palace_count,
        "segment_count": segment_count,
    }


def _default_algorithm(session: Session) -> str:
    return load_review_schedule_policy(session).default_algorithm


def _segment_anchor_date(segment: PalaceSegment) -> date:
    if segment.created_at:
        return segment.created_at.date()
    return date.today()


def _copy_segment_schedule(
    segment: PalaceSegment,
    draft: ReviewScheduleDraft,
    *,
    completed: bool,
    completed_at: datetime | None,
) -> PalaceSegmentReviewSchedule:
    return PalaceSegmentReviewSchedule(
        palace_segment_id=segment.id,
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


def _coerce_stage_completed_at(
    value: datetime | None,
    *,
    fallback: datetime | None = None,
) -> datetime:
    target = value or fallback or datetime.now()
    return target.replace(second=0, microsecond=0)


def _collect_completed_stage_times(
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
        completed_at_by_stage[review_number] = _coerce_stage_completed_at(
            getattr(completed_schedule, "completed_at", None)
        )
    return completed_at_by_stage


def _target_pending_review_numbers(
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


def _resolve_effective_stage_anchor_at(
    *,
    use_anchor_mode: bool,
    actual_completed_at: datetime,
    scheduled_display_at: datetime | None,
) -> datetime:
    normalized_completed_at = _coerce_stage_completed_at(actual_completed_at)
    if (
        use_anchor_mode
        and scheduled_display_at is not None
        and normalized_completed_at < scheduled_display_at
        and normalized_completed_at.date() == scheduled_display_at.date()
    ):
        return scheduled_display_at.replace(second=0, microsecond=0)
    return normalized_completed_at


def _existing_schedule_display_at(
    schedules: list[Any],
    review_number: int,
    *,
    policy: ReviewSchedulePolicy,
    palace: Palace | None = None,
    segment: PalaceSegment | None = None,
) -> datetime | None:
    existing_schedule = next(
        (
            schedule
            for schedule in schedules
            if int(getattr(schedule, "review_number", -1)) == review_number
        ),
        None,
    )
    if existing_schedule is None:
        return None
    if palace is not None:
        return schedule_display_datetime_for_policy(
            policy,
            scheduled_date=getattr(existing_schedule, "scheduled_date", None),
            scheduled_at=getattr(existing_schedule, "scheduled_at", None),
            review_type=getattr(existing_schedule, "review_type", None),
            anchor_datetime=palace.created_at or palace.updated_at,
        )
    if segment is not None:
        return schedule_display_datetime_for_policy(
            policy,
            scheduled_date=getattr(existing_schedule, "scheduled_date", None),
            scheduled_at=getattr(existing_schedule, "scheduled_at", None),
            review_type=getattr(existing_schedule, "review_type", None),
            anchor_datetime=(
                segment.created_at
                or (segment.palace.created_at if segment.palace else None)
            ),
        )
    return None


def _create_palace_schedule_from_draft(
    session: Session,
    *,
    palace_id: int,
    draft: ReviewScheduleDraft | None,
) -> ReviewSchedule | None:
    if draft is None:
        return None
    return create_review_schedule_from_draft(
        session,
        palace_id=palace_id,
        draft=draft,
    )


def _create_segment_schedule_from_draft(
    session: Session,
    *,
    segment: PalaceSegment,
    draft: ReviewScheduleDraft | None,
    completed: bool,
    completed_at: datetime | None,
) -> PalaceSegmentReviewSchedule | None:
    if draft is None:
        return None
    schedule = _copy_segment_schedule(
        segment,
        draft,
        completed=completed,
        completed_at=completed_at,
    )
    session.add(schedule)
    return schedule
