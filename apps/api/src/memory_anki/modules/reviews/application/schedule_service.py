"""Review schedule policies."""

from datetime import date, datetime
from typing import Any

from .schedule_policy import (
    build_review_schedule_draft,
    create_review_schedule_from_draft,
    get_algorithm_intervals_for_policy,
    get_initial_same_day_slot_count_for_policy,
    load_review_schedule_policy,
    schedule_display_datetime_for_policy,
)
from .schedule_rebuild_service import (
    rebuild_palace_review_schedules,
)


def get_config_value(session, key: str) -> str:
    from memory_anki.core.config import DEFAULTS
    from memory_anki.infrastructure.db._tables.misc import Config

    with session.no_autoflush:
        row = session.query(Config).filter_by(key=key).first()
    if row:
        return row.value
    return DEFAULTS.get(key, "")


def use_anchor(session) -> bool:
    return load_review_schedule_policy(session).early_review_anchor


def get_algorithm_intervals(session) -> list[str]:
    return get_algorithm_intervals_for_policy(load_review_schedule_policy(session))


def format_interval_label(value: str) -> str:
    normalized = str(value or "").strip()
    if normalized == "1h":
        return "1小时"
    if normalized == "sleep":
        return "睡前"
    if normalized.isdigit():
        days = int(normalized)
        return f"{days}天"
    return normalized or "未命名轮次"


def get_algorithm_stage_labels(session) -> list[str]:
    return [format_interval_label(item) for item in get_algorithm_intervals(session)]


def get_initial_same_day_slot_count(session) -> int:
    return get_initial_same_day_slot_count_for_policy(load_review_schedule_policy(session))


def schedule_display_datetime(schedule, palace, session) -> datetime | None:
    return schedule_display_datetime_for_policy(
        load_review_schedule_policy(session),
        scheduled_date=schedule.scheduled_date,
        scheduled_at=getattr(schedule, "scheduled_at", None),
        review_type=getattr(schedule, "review_type", None),
        anchor_datetime=palace.created_at or palace.updated_at,
    )


def is_schedule_due(schedule, palace, session, now: datetime | None = None) -> bool:
    if schedule.completed:
        return False
    due_at = schedule_display_datetime(schedule, palace, session)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at <= current


def is_schedule_due_or_later_today(schedule, palace, session, now: datetime | None = None) -> bool:
    if schedule.completed:
        return False
    due_at = schedule_display_datetime(schedule, palace, session)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at <= current or due_at.date() == current.date()


def is_schedule_overdue(schedule, palace, session, now: datetime | None = None) -> bool:
    if schedule.completed:
        return False
    due_at = schedule_display_datetime(schedule, palace, session)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at.date() < current.date() and due_at <= current


def create_review_schedule(
    session,
    *,
    palace_id: int,
    review_number: int,
    base_date: date,
    anchor_date: date,
    base_datetime: datetime | None = None,
    completed: bool = False,
    completed_at: datetime | None = None,
):
    draft = build_review_schedule_draft(
        load_review_schedule_policy(session),
        review_number=review_number,
        base_date=base_date,
        anchor_date=anchor_date,
        base_datetime=base_datetime,
        completed=completed,
        completed_at=completed_at,
    )
    if draft is None:
        return None
    return create_review_schedule_from_draft(
        session,
        palace_id=palace_id,
        draft=draft,
    )
def create_initial_review_schedules(
    session,
    palace_id: int,
    anchor_date: date | None = None,
    *,
    commit: bool = True,
) -> None:
    anchor = anchor_date or date.today()
    intervals = get_algorithm_intervals(session)
    if not intervals:
        return

    slot_count = max(1, get_initial_same_day_slot_count(session))
    for review_number in range(min(slot_count, len(intervals))):
        create_review_schedule(
            session,
            palace_id=palace_id,
            review_number=review_number,
            base_date=anchor,
            anchor_date=anchor,
            completed=False,
        )
    if commit:
        session.commit()

def infer_completed_stage_count(session, palace) -> int:
    from memory_anki.infrastructure.db._tables.palaces import ReviewLog

    intervals = get_algorithm_intervals(session)
    initial_slot_count = max(1, get_initial_same_day_slot_count(session))
    review_logs = (
        session.query(ReviewLog)
        .filter_by(palace_id=palace.id)
        .order_by(ReviewLog.review_date.asc(), ReviewLog.id.asc())
        .all()
    )

    anchor_date = _resolve_anchor_date(palace)
    counted = 0
    counts_by_day: dict[date, int] = {}
    for log in review_logs:
        review_day = log.review_date or anchor_date
        current_count = counts_by_day.get(review_day, 0)
        daily_cap = initial_slot_count if review_day == anchor_date else 1
        if current_count >= daily_cap:
            continue
        counts_by_day[review_day] = current_count + 1
        counted += 1

    return min(counted, len(intervals))


def _infer_schedule_completed_stage_count(
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

    # Legacy rows sometimes only stored the next pending review_number. Treat that
    # as a lower-bound progress marker, but never let logs reduce schedule truth.
    if pending_numbers:
        completed_count = max(completed_count, min(pending_numbers[0], total))
    if fallback_completed_count is not None:
        completed_count = max(completed_count, min(fallback_completed_count, total))
    if mastered and total > 0:
        completed_count = total

    return max(0, min(completed_count, total))


def _review_log_completed_stage_count(session, palace, total: int) -> int:
    if total <= 0:
        return 0
    return max(0, min(infer_completed_stage_count(session, palace), total))


def ensure_current_review_schedule_model(session) -> int:
    from memory_anki.infrastructure.db._tables.palaces import Palace

    palaces = session.query(Palace).filter(Palace.deleted_at.is_(None)).all()
    changed = 0
    for palace in palaces:
        changed += _rebuild_palace_review_schedule_model(session, palace)

    session.commit()
    return changed


def ensure_palace_review_schedule_model(session, palace_id: int) -> int:
    from memory_anki.infrastructure.db._tables.palaces import Palace

    palace = (
        session.query(Palace)
        .filter(
            Palace.id == palace_id,
            Palace.deleted_at.is_(None),
        )
        .first()
    )
    if palace is None:
        return 0
    return _rebuild_palace_review_schedule_model(session, palace)


def _resolve_anchor_date(palace, schedules: list | None = None) -> date:
    ordered_schedules = schedules or list(palace.review_schedules or [])
    for schedule in ordered_schedules:
        if schedule.anchor_date:
            return schedule.anchor_date
    if palace.created_at:
        return palace.created_at.date()
    return date.today()


def _rebuild_palace_review_schedule_model(session, palace) -> int:
    schedules = sorted(
        list(palace.review_schedules or []),
        key=lambda schedule: (schedule.review_number, schedule.id),
    )
    intervals = get_algorithm_intervals(session)
    if not intervals:
        return 0

    completed_stage_count = _infer_schedule_completed_stage_count(
        total=len(intervals),
        schedules=schedules,
        mastered=palace.mastered,
        fallback_completed_count=_review_log_completed_stage_count(
            session,
            palace,
            len(intervals),
        )
        if not schedules
        else None,
    )
    fallback_completed_count = completed_stage_count
    if not schedules:
        fallback_completed_count = _review_log_completed_stage_count(
            session,
            palace,
            len(intervals),
        )

    rebuild_palace_review_schedules(
        session,
        palace,
        completed_count=completed_stage_count,
        fallback_completed_count=fallback_completed_count,
    )
    return max(len(schedules), completed_stage_count, fallback_completed_count, 1)
