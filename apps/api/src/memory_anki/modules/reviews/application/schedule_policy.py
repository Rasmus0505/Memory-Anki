from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta


@dataclass(frozen=True, slots=True)
class ReviewSchedulePolicy:
    default_algorithm: str
    ebbinghaus_intervals: tuple[str, ...]
    custom_intervals: tuple[str, ...]
    early_review_anchor: bool
    sleep_review_time: time


@dataclass(frozen=True, slots=True)
class ReviewScheduleDraft:
    scheduled_date: date
    scheduled_at: datetime | None
    interval_days: int
    algorithm_used: str
    completed: bool
    completed_at: datetime | None
    review_number: int
    review_type: str
    anchor_date: date


def normalize_algorithm(algorithm: str | None) -> str:
    if algorithm == "custom":
        return "custom"
    return "ebbinghaus"


def load_review_schedule_policy(session) -> ReviewSchedulePolicy:
    from memory_anki.core.config import DEFAULTS
    from memory_anki.infrastructure.db.models import Config

    keys = [
        "default_algorithm",
        "ebbinghaus_intervals",
        "custom_intervals",
        "early_review_anchor",
        "sleep_review_time",
    ]
    with session.no_autoflush:
        rows = (
            session.query(Config)
            .filter(Config.key.in_(keys))
            .all()
        )
    values = {row.key: row.value for row in rows}

    default_algorithm = normalize_algorithm(
        values.get("default_algorithm", DEFAULTS.get("default_algorithm", ""))
    )
    ebbinghaus_intervals = _split_intervals(
        values.get("ebbinghaus_intervals", DEFAULTS.get("ebbinghaus_intervals", ""))
    )
    custom_intervals = tuple(
        item
        for item in _split_intervals(
            values.get("custom_intervals", DEFAULTS.get("custom_intervals", ""))
        )
        if item.isdigit()
    )
    early_review_anchor = values.get(
        "early_review_anchor",
        DEFAULTS.get("early_review_anchor", ""),
    ) == "true"
    sleep_review_time = _parse_sleep_review_time(
        values.get("sleep_review_time", DEFAULTS.get("sleep_review_time", "22:00"))
    )
    return ReviewSchedulePolicy(
        default_algorithm=default_algorithm,
        ebbinghaus_intervals=ebbinghaus_intervals,
        custom_intervals=custom_intervals,
        early_review_anchor=early_review_anchor,
        sleep_review_time=sleep_review_time,
    )


def get_algorithm_intervals_for_policy(
    policy: ReviewSchedulePolicy,
    algorithm: str,
) -> list[str]:
    normalized_algorithm = normalize_algorithm(algorithm)
    intervals = (
        list(policy.custom_intervals)
        if normalized_algorithm == "custom"
        else list(policy.ebbinghaus_intervals)
    )
    if not intervals:
        intervals = ["1", "2", "4", "7", "15", "30", "60"]
    return intervals


def get_initial_same_day_slot_count_for_policy(
    policy: ReviewSchedulePolicy,
    algorithm: str,
) -> int:
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    count = 0
    for value in intervals:
        if value in {"1h", "sleep"}:
            count += 1
            continue
        break
    return count


def build_review_schedule_draft(
    policy: ReviewSchedulePolicy,
    *,
    review_number: int,
    algorithm: str,
    base_date: date,
    anchor_date: date,
    base_datetime: datetime | None = None,
    completed: bool = False,
    completed_at: datetime | None = None,
) -> ReviewScheduleDraft | None:
    intervals = get_algorithm_intervals_for_policy(policy, algorithm)
    normalized_algorithm = normalize_algorithm(algorithm)
    if review_number >= len(intervals):
        return None

    value = intervals[review_number]
    scheduled_at = None
    if base_datetime is not None:
        interval_days, scheduled_at, review_type, algorithm_used = resolve_interval_from_base_datetime_for_policy(
            policy,
            value,
            base_datetime,
            normalized_algorithm,
        )
        scheduled_date = scheduled_at.date()
    else:
        interval_days, scheduled_date, review_type, algorithm_used = resolve_interval_from_base_date(
            value,
            base_date,
            normalized_algorithm,
        )
    return ReviewScheduleDraft(
        scheduled_date=scheduled_date,
        scheduled_at=scheduled_at,
        interval_days=interval_days,
        algorithm_used=algorithm_used,
        completed=completed,
        completed_at=completed_at,
        review_number=review_number,
        review_type=review_type,
        anchor_date=anchor_date,
    )


def create_review_schedule_from_draft(session, *, palace_id: int, draft: ReviewScheduleDraft):
    from memory_anki.infrastructure.db.models import ReviewSchedule

    schedule = ReviewSchedule(
        palace_id=palace_id,
        scheduled_date=draft.scheduled_date,
        scheduled_at=draft.scheduled_at,
        interval_days=draft.interval_days,
        algorithm_used=draft.algorithm_used,
        completed=draft.completed,
        completed_at=draft.completed_at,
        review_number=draft.review_number,
        review_type=draft.review_type,
        anchor_date=draft.anchor_date,
    )
    session.add(schedule)
    return schedule


def schedule_display_datetime_for_policy(
    policy: ReviewSchedulePolicy,
    *,
    scheduled_date: date | None,
    scheduled_at: datetime | None,
    review_type: str | None,
    anchor_datetime: datetime | None,
) -> datetime | None:
    if scheduled_at:
        return scheduled_at.replace(second=0, microsecond=0)
    if not scheduled_date:
        return None

    base_time = (
        anchor_datetime.time().replace(second=0, microsecond=0)
        if anchor_datetime
        else time(0, 0)
    )

    if review_type == "sleep":
        display_time = policy.sleep_review_time
    elif review_type == "1h":
        display_time = (
            datetime.combine(scheduled_date, base_time) + timedelta(hours=1)
        ).time().replace(second=0, microsecond=0)
    else:
        display_time = base_time
    return datetime.combine(scheduled_date, display_time)


def resolve_interval(value: str, anchor_date: date | None, algorithm: str) -> tuple[int, date, str, str]:
    today = date.today()
    if value == "1h":
        return 0, today, "1h", algorithm
    if value == "sleep":
        return 0, today, "sleep", algorithm

    days = int(value)
    base = anchor_date or today
    return days, base + timedelta(days=days), "standard", algorithm


def resolve_interval_from_base_date(value: str, base_date: date, algorithm: str) -> tuple[int, date, str, str]:
    normalized_algorithm = normalize_algorithm(algorithm)
    if value == "1h":
        return 0, base_date, "1h", normalized_algorithm
    if value == "sleep":
        return 0, base_date, "sleep", normalized_algorithm
    days = int(value)
    return days, base_date + timedelta(days=days), "standard", normalized_algorithm


def resolve_interval_from_base_datetime_for_policy(
    policy: ReviewSchedulePolicy,
    value: str,
    base_datetime: datetime,
    algorithm: str,
) -> tuple[int, datetime, str, str]:
    normalized_algorithm = normalize_algorithm(algorithm)
    clean_value = str(value or "").strip()
    if clean_value == "1h":
        return 0, base_datetime + timedelta(hours=1), "1h", normalized_algorithm
    if clean_value == "sleep":
        sleep_at = datetime.combine(base_datetime.date(), policy.sleep_review_time)
        if base_datetime >= sleep_at:
            sleep_at += timedelta(days=1)
        return 0, sleep_at, "sleep", normalized_algorithm
    days = int(clean_value)
    return days, base_datetime + timedelta(days=days), "standard", normalized_algorithm


def _split_intervals(raw: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in str(raw or "").split(",") if item.strip())


def _parse_sleep_review_time(value: str | None) -> time:
    raw_sleep_time = value or "22:00"
    try:
        hour_str, minute_str = raw_sleep_time.split(":", 1)
        return time(int(hour_str), int(minute_str))
    except (ValueError, TypeError):
        return time(22, 0)
