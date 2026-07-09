from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    ReviewSchedule,
    SessionProgress,
)

from .schedule_policy import (
    ReviewScheduleDraft,
    ReviewSchedulePolicy,
    build_review_schedule_draft,
    create_review_schedule_from_draft,
    get_algorithm_intervals_for_policy,
    get_initial_same_day_slot_count_for_policy,
    load_review_schedule_policy,
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
    preserve_existing_progress: bool = False,
    preserve_same_day_slots: bool = True,
) -> None:
    policy = load_review_schedule_policy(session)
    intervals = get_algorithm_intervals_for_policy(policy)
    total = len(intervals)
    safe_completed_count = max(0, min(completed_count, total))
    anchor = palace_anchor_date(palace)
    initial_slot_count = max(1, get_initial_same_day_slot_count_for_policy(policy))
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
    active_progress_by_stage = _collect_active_review_progress_by_stage(
        session,
        schedules=existing_schedules,
    )

    existing_schedule_ids = [
        int(schedule.id)
        for schedule in existing_schedules
        if getattr(schedule, "id", None) is not None
    ]
    if existing_schedule_ids:
        (
            session.query(SessionProgress)
            .filter(
                SessionProgress.session_kind == "review",
                SessionProgress.review_schedule_id.in_(existing_schedule_ids),
            )
            .delete(synchronize_session=False)
        )
        session.flush()

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
            if draft is not None and draft.scheduled_at is not None
            else None
        )
        previous_anchor_at = _resolve_effective_stage_anchor_at(
            use_anchor_mode=policy.early_review_anchor,
            actual_completed_at=stage_completed_at,
            scheduled_display_at=scheduled_display_at,
        )

    palace.mastered = effective_completed_count >= total and total > 0
    created_schedules: list[ReviewSchedule] = []
    if not palace.mastered:
        pending_review_numbers = (
            _target_pending_review_numbers(
                completed_count=effective_completed_count,
                total=total,
                initial_slot_count=initial_slot_count,
            )
            if preserve_same_day_slots
            else ([effective_completed_count] if effective_completed_count < total else [])
        )
        for review_number in pending_review_numbers:
            base_datetime = previous_anchor_at if review_number >= initial_slot_count else None
            base_date = (
                previous_anchor_at.date()
                if previous_anchor_at is not None and not preserve_same_day_slots
                else anchor
            )
            draft = build_review_schedule_draft(
                policy,
                review_number=review_number,
                base_date=base_date if base_datetime is None else base_datetime.date(),
                anchor_date=anchor,
                base_datetime=base_datetime,
                completed=False,
            )
            created_schedule = _create_palace_schedule_from_draft(
                session,
                palace_id=palace.id,
                draft=draft,
            )
            if created_schedule is not None:
                created_schedules.append(created_schedule)

    session.flush()
    _restore_active_review_progress(
        session,
        palace_id=palace.id,
        schedules=created_schedules,
        progress_by_stage=active_progress_by_stage,
    )
    session.flush()


def rebuild_all_pending_review_schedules(session: Session) -> dict[str, Any]:
    palace_count = 0
    policy = load_review_schedule_policy(session)

    palaces = session.query(Palace).filter(Palace.deleted_at.is_(None)).all()
    for palace in palaces:
        total = len(get_algorithm_intervals_for_policy(policy))
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
        )
        palace_count += 1

    session.commit()
    return {
        "palace_count": palace_count,
        "segment_count": 0,
    }

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


def _collect_active_review_progress_by_stage(
    session: Session,
    *,
    schedules: list[Any],
) -> dict[int, dict[str, Any]]:
    schedule_by_id = {
        int(schedule.id): schedule
        for schedule in schedules
        if getattr(schedule, "id", None) is not None
    }
    if not schedule_by_id:
        return {}

    progress_rows = (
        session.query(SessionProgress)
        .filter(
            SessionProgress.session_kind == "review",
            SessionProgress.review_schedule_id.in_(list(schedule_by_id)),
            SessionProgress.completed == False,
        )
        .all()
    )
    progress_by_stage: dict[int, dict[str, Any]] = {}
    for progress in progress_rows:
        schedule = schedule_by_id.get(int(progress.review_schedule_id or 0))
        if schedule is None:
            continue
        review_number = int(schedule.review_number)
        existing = progress_by_stage.get(review_number)
        if existing is not None and _progress_updated_at(existing) >= _progress_updated_at(progress):
            continue
        progress_by_stage[review_number] = {
            "reveal_map": progress.reveal_map,
            "red_node_ids": progress.red_node_ids,
            "completed": bool(progress.completed),
            "updated_at": progress.updated_at,
        }
    return progress_by_stage


def _progress_updated_at(progress: SessionProgress | dict[str, Any]) -> datetime:
    updated_at = (
        progress.get("updated_at")
        if isinstance(progress, dict)
        else getattr(progress, "updated_at", None)
    )
    return updated_at or datetime.min


def _restore_active_review_progress(
    session: Session,
    *,
    palace_id: int,
    schedules: list[ReviewSchedule],
    progress_by_stage: dict[int, dict[str, Any]],
) -> None:
    if not schedules or not progress_by_stage:
        return

    for schedule in schedules:
        if schedule.completed:
            continue
        snapshot = progress_by_stage.get(int(schedule.review_number))
        if snapshot is None:
            continue
        progress = (
            session.query(SessionProgress)
            .filter_by(session_kind="review", review_schedule_id=schedule.id)
            .first()
        )
        if progress is None:
            progress = SessionProgress(
                session_kind="review",
                review_schedule_id=schedule.id,
            )
            session.add(progress)
        progress.palace_id = palace_id
        progress.palace_segment_id = None
        progress.mini_palace_id = None
        progress.reveal_map = snapshot["reveal_map"]
        progress.red_node_ids = snapshot["red_node_ids"]
        progress.completed = bool(snapshot["completed"])
        progress.updated_at = snapshot["updated_at"]


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
    if getattr(existing_schedule, "scheduled_at", None) is None:
        return None
    if palace is not None:
        return schedule_display_datetime_for_policy(
            policy,
            scheduled_date=getattr(existing_schedule, "scheduled_date", None),
            scheduled_at=getattr(existing_schedule, "scheduled_at", None),
            review_type=getattr(existing_schedule, "review_type", None),
            anchor_datetime=palace.created_at or palace.updated_at,
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
