"""Review submission and repair commands."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    ReviewLog,
    ReviewSchedule,
)
from memory_anki.modules.reviews.application.schedule_rebuild_service import (
    rebuild_all_pending_review_schedules,
    rebuild_palace_review_schedules,
)
from memory_anki.modules.reviews.application.schedule_service import (
    create_initial_review_schedules,
    get_algorithm_intervals,
    get_config_value,
    get_initial_same_day_slot_count,
    is_schedule_due_or_later_today,
    normalize_algorithm,
)
from memory_anki.modules.sessions.application.study_session_service import (
    create_review_study_session,
)


def _resolve_completed_count_after_submit(
    *,
    session: Session,
    algorithm: str,
    schedule_review_type: str | None,
    schedule_review_number: int,
    requested_completed_count: int,
    total_intervals: int,
) -> int:
    completed_count = min(requested_completed_count, total_intervals)
    if schedule_review_type == "standard":
        return completed_count
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
    if schedule_review_number < initial_slot_count:
        return max(completed_count, min(initial_slot_count, total_intervals))
    return completed_count


def _should_preserve_same_day_slots(schedule_review_type: str | None) -> bool:
    return schedule_review_type in {"1h", "sleep"}


def submit_review(
    session: Session,
    schedule_id: int,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
    target_review_number: int | None = None,
    needs_practice: bool = False,
    *,
    commit: bool = True,
) -> tuple[ReviewLog | None, dict]:
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return None, {}

    if not schedule.palace or not is_schedule_due_or_later_today(
        schedule,
        schedule.palace,
        session,
    ):
        return None, {}

    completed_at = datetime.now().replace(second=0, microsecond=0)
    today = completed_at.date()
    palace = schedule.palace
    log = ReviewLog(
        palace_id=schedule.palace_id,
        review_date=today,
        score=5,
        review_mode="review",
        duration_seconds=duration_seconds,
    )
    session.add(log)
    extra: dict[str, bool] = {}
    algorithm = normalize_algorithm(schedule.algorithm_used)
    intervals = get_algorithm_intervals(session, algorithm)
    next_review_number = (
        target_review_number + 1
        if target_review_number is not None
        else schedule.review_number + 1
    )
    completed_count = _resolve_completed_count_after_submit(
        session=session,
        algorithm=algorithm,
        schedule_review_type=schedule.review_type,
        schedule_review_number=schedule.review_number,
        requested_completed_count=next_review_number,
        total_intervals=len(intervals),
    )

    rebuild_palace_review_schedules(
        session,
        palace,
        completed_count=completed_count,
        completed_review_number=schedule.review_number,
        completed_at=completed_at,
        preserve_existing_progress=False,
        preserve_same_day_slots=_should_preserve_same_day_slots(schedule.review_type),
    )
    palace.needs_practice = bool(needs_practice)
    if next_review_number >= len(intervals):
        extra["mastered"] = True

    session.flush()
    create_review_study_session(
        session,
        session_id=f"review-log-{log.id}",
        scene="review",
        target_type="review_schedule",
        target_id=schedule_id,
        palace_id=schedule.palace_id,
        palace_segment_id=None,
        title=palace.title if palace else "未命名宫殿",
        duration_seconds=duration_seconds,
        ended_at=completed_at,
        completion_method=completion_mode or "manual_complete",
        summary={
            "review_number": schedule.review_number,
            "target_review_number": target_review_number,
            "needs_practice": bool(needs_practice),
        },
        commit=commit,
    )
    if commit:
        session.commit()
        session.refresh(log)
    else:
        session.flush()
    return log, extra


def repair_review_stage_progress(session: Session) -> dict:
    return rebuild_all_pending_review_schedules(session)


def trigger_review_for_palace(session: Session, palace_id: int) -> None:
    existing = session.query(ReviewSchedule).filter_by(palace_id=palace_id).first()
    if existing:
        return
    create_initial_review_schedules(session, palace_id, "ebbinghaus")
