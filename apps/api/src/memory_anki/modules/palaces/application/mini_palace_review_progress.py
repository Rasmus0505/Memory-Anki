from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    PalaceMiniPalace,
    PalaceMiniPalaceReviewLog,
    PalaceMiniPalaceReviewSchedule,
)
from memory_anki.modules.reviews.application.schedule_policy import (
    build_review_schedule_draft,
    get_algorithm_intervals_for_policy,
    get_initial_same_day_slot_count_for_policy,
    load_review_schedule_policy,
    normalize_algorithm,
    schedule_display_datetime_for_policy,
)

from .mini_palace_review_support import (
    collect_completed_stage_times,
    coerce_stage_completed_at,
    create_mini_schedule_from_draft,
    existing_mini_schedule_display_at,
    mini_palace_is_empty,
    parse_progress_datetime,
    resolve_effective_stage_anchor_at,
    resolve_mini_palace_algorithm,
    resolve_mini_palace_anchor_date,
    resolve_mini_palace_anchor_datetime,
    target_pending_review_numbers,
)


def create_mini_palace_review_log(
    session: Session,
    *,
    mini_palace: PalaceMiniPalace,
    duration_seconds: int,
    completed_at: datetime | None = None,
) -> PalaceMiniPalaceReviewLog:
    effective_completed_at = completed_at or datetime.now()
    log = PalaceMiniPalaceReviewLog(
        palace_mini_palace_id=mini_palace.id,
        review_date=effective_completed_at.date(),
        score=5,
        review_mode="review",
        duration_seconds=max(0, int(duration_seconds)),
    )
    session.add(log)
    session.flush()
    return log


def adjust_mini_palace_review_progress(
    session: Session,
    mini_palace: PalaceMiniPalace,
    payload: dict[str, Any],
) -> PalaceMiniPalace:
    completed_at = parse_progress_datetime(payload.get("completed_at"))
    completed_review_number = payload.get("completed_review_number")
    if completed_review_number is not None:
        completed_review_number = int(completed_review_number)
    rebuild_mini_palace_review_progress(
        session,
        mini_palace,
        completed_count=int(payload.get("completed_count", 0)),
        completed_review_number=completed_review_number,
        completed_at=completed_at,
    )
    if "needs_practice" in payload:
        mini_palace.needs_practice = bool(payload.get("needs_practice", False))
    session.commit()
    session.refresh(mini_palace)
    return mini_palace


def rebuild_mini_palace_review_progress(
    session: Session,
    mini_palace: PalaceMiniPalace,
    *,
    completed_count: int,
    completed_review_number: int | None = None,
    completed_at: datetime | None = None,
    algorithm_override: str | None = None,
) -> None:
    policy = load_review_schedule_policy(session)
    algorithm = normalize_algorithm(
        algorithm_override
        or resolve_mini_palace_algorithm(session, mini_palace, default_algorithm=policy.default_algorithm)
    )
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    total = len(intervals)
    safe_completed_count = max(0, min(completed_count, total))
    anchor = resolve_mini_palace_anchor_date(mini_palace)
    initial_slot_count = max(1, get_initial_same_day_slot_count_for_policy(policy, algorithm))
    existing_schedules = sorted(
        list(mini_palace.review_schedules or []),
        key=lambda item: (item.review_number, item.id),
    )
    completed_at_by_stage = collect_completed_stage_times(
        schedules=existing_schedules,
        completed_count=safe_completed_count,
    )

    if (
        completed_review_number is not None
        and 0 <= completed_review_number < safe_completed_count
        and completed_at is not None
    ):
        completed_at_by_stage[completed_review_number] = coerce_stage_completed_at(completed_at)
    elif completed_at is not None and safe_completed_count > 0:
        normalized_completed_at = coerce_stage_completed_at(completed_at)
        completed_at_by_stage[safe_completed_count - 1] = normalized_completed_at
        for review_number in range(safe_completed_count):
            completed_at_by_stage.setdefault(review_number, normalized_completed_at)

    session.query(PalaceMiniPalaceReviewSchedule).filter_by(
        palace_mini_palace_id=mini_palace.id
    ).delete(synchronize_session=False)
    session.flush()
    for schedule in existing_schedules:
        if sqlalchemy_inspect(schedule).session is session:
            session.expunge(schedule)
    session.expire(mini_palace, ["review_schedules"])

    previous_anchor_at: datetime | None = None
    for review_number in range(safe_completed_count):
        stage_completed_at = coerce_stage_completed_at(
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
        create_mini_schedule_from_draft(
            session,
            mini_palace=mini_palace,
            draft=draft,
            completed=True,
            completed_at=stage_completed_at,
        )
        scheduled_display_at = existing_mini_schedule_display_at(
            existing_schedules,
            review_number,
            policy=policy,
            mini_palace=mini_palace,
        ) or (
            schedule_display_datetime_for_policy(
                policy,
                scheduled_date=draft.scheduled_date,
                scheduled_at=draft.scheduled_at,
                review_type=draft.review_type,
                anchor_datetime=resolve_mini_palace_anchor_datetime(mini_palace),
            )
            if draft is not None and draft.scheduled_at is not None
            else None
        )
        previous_anchor_at = resolve_effective_stage_anchor_at(
            use_anchor_mode=policy.early_review_anchor,
            actual_completed_at=stage_completed_at,
            scheduled_display_at=scheduled_display_at,
        )

    if mini_palace_is_empty(mini_palace):
        session.flush()
        return

    for review_number in target_pending_review_numbers(
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
        create_mini_schedule_from_draft(
            session,
            mini_palace=mini_palace,
            draft=draft,
            completed=False,
            completed_at=None,
        )
    session.flush()


__all__ = [
    "adjust_mini_palace_review_progress",
    "create_mini_palace_review_log",
    "rebuild_mini_palace_review_progress",
]
