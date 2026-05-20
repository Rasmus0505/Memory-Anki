"""Review schedule policies."""

from datetime import date, datetime, time, timedelta
from typing import Any


def normalize_algorithm(algorithm: str | None) -> str:
    if algorithm == "custom":
        return "custom"
    return "ebbinghaus"


def get_config_value(session, key: str) -> str:
    from memory_anki.core.config import DEFAULTS
    from memory_anki.infrastructure.db.models import Config

    row = session.query(Config).filter_by(key=key).first()
    if row:
        if key == "default_algorithm":
            return normalize_algorithm(row.value)
        return row.value
    return DEFAULTS.get(key, "")


def ebbinghaus_intervals(session) -> list[str]:
    raw = get_config_value(session, "ebbinghaus_intervals")
    return [item.strip() for item in raw.split(",") if item.strip()]


def custom_intervals(session) -> list[str]:
    raw = get_config_value(session, "custom_intervals")
    return [item.strip() for item in raw.split(",") if item.strip() and item.strip().isdigit()]


def use_anchor(session) -> bool:
    return get_config_value(session, "early_review_anchor") == "true"


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


def _sleep_review_time(session) -> time:
    raw_sleep_time = get_config_value(session, "sleep_review_time") or "22:00"
    try:
        hour_str, minute_str = raw_sleep_time.split(":", 1)
        return time(int(hour_str), int(minute_str))
    except (ValueError, TypeError):
        return time(22, 0)


def resolve_interval_from_base_datetime(
    session,
    value: str,
    base_datetime: datetime,
    algorithm: str,
) -> tuple[int, datetime, str, str]:
    normalized_algorithm = normalize_algorithm(algorithm)
    clean_value = str(value or "").strip()
    if clean_value == "1h":
        return 0, base_datetime + timedelta(hours=1), "1h", normalized_algorithm
    if clean_value == "sleep":
        sleep_at = datetime.combine(base_datetime.date(), _sleep_review_time(session))
        if base_datetime >= sleep_at:
            sleep_at += timedelta(days=1)
        return 0, sleep_at, "sleep", normalized_algorithm
    days = int(clean_value)
    return days, base_datetime + timedelta(days=days), "standard", normalized_algorithm


def get_algorithm_intervals(session, algorithm: str) -> list[str]:
    normalized_algorithm = normalize_algorithm(algorithm)
    intervals = custom_intervals(session) if normalized_algorithm == "custom" else ebbinghaus_intervals(session)
    if not intervals:
        intervals = ["1", "2", "4", "7", "15", "30", "60"]
    return intervals


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


def get_algorithm_stage_labels(session, algorithm: str) -> list[str]:
    return [format_interval_label(item) for item in get_algorithm_intervals(session, algorithm)]


def get_initial_same_day_slot_count(session, algorithm: str) -> int:
    intervals = get_algorithm_intervals(session, algorithm)
    count = 0
    for value in intervals:
        if value in {"1h", "sleep"}:
            count += 1
            continue
        break
    return count


def compute_next_review(
    session,
    algorithm: str,
    review_number: int,
    prev_interval: int,
    anchor_date: date | None = None,
) -> tuple[int, date, str, str]:
    normalized_algorithm = normalize_algorithm(algorithm)
    intervals = get_algorithm_intervals(session, normalized_algorithm)
    value = intervals[-1] if review_number >= len(intervals) else intervals[review_number]
    return resolve_interval(value, anchor_date, normalized_algorithm)


def schedule_display_datetime(schedule, palace, session) -> datetime | None:
    if getattr(schedule, "scheduled_at", None):
        return schedule.scheduled_at.replace(second=0, microsecond=0)
    if not schedule.scheduled_date:
        return None

    created_at = palace.created_at or palace.updated_at
    base_time = created_at.time().replace(second=0, microsecond=0) if created_at else time(0, 0)

    if schedule.review_type == "sleep":
        display_time = _sleep_review_time(session)
    elif schedule.review_type == "1h":
        display_time = (datetime.combine(schedule.scheduled_date, base_time) + timedelta(hours=1)).time().replace(second=0, microsecond=0)
    else:
        display_time = base_time

    return datetime.combine(schedule.scheduled_date, display_time)


def is_schedule_due(schedule, palace, session, now: datetime | None = None) -> bool:
    if schedule.completed:
        return False
    due_at = schedule_display_datetime(schedule, palace, session)
    if due_at is None:
        return False
    current = now or datetime.now()
    return due_at <= current


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
    algorithm: str,
    base_date: date,
    anchor_date: date,
    base_datetime: datetime | None = None,
    completed: bool = False,
    completed_at: datetime | None = None,
):
    from memory_anki.infrastructure.db.models import ReviewSchedule

    intervals = get_algorithm_intervals(session, algorithm)
    normalized_algorithm = normalize_algorithm(algorithm)
    if review_number >= len(intervals):
        return None

    value = intervals[review_number]
    scheduled_at = None
    if base_datetime is not None:
        interval_days, scheduled_at, review_type, algorithm_used = resolve_interval_from_base_datetime(
            session,
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
    schedule = ReviewSchedule(
        palace_id=palace_id,
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
    session.add(schedule)
    return schedule


def ensure_review_schedule_schema() -> None:
    from memory_anki.infrastructure.db.models import engine

    table_columns = {
        "review_schedules": (("scheduled_at", "DATETIME"), ("completed_at", "DATETIME")),
        "palace_segment_review_schedules": (("scheduled_at", "DATETIME"), ("completed_at", "DATETIME")),
    }
    with engine.begin() as conn:
        for table_name, columns in table_columns.items():
            existing = {
                row[1]
                for row in conn.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
            }
            if not existing:
                continue
            for column_name, column_type in columns:
                if column_name not in existing:
                    conn.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                    )


def create_initial_review_schedules(session, palace_id: int, algorithm: str, anchor_date: date | None = None) -> None:
    anchor = anchor_date or date.today()
    intervals = get_algorithm_intervals(session, algorithm)
    if not intervals:
        return

    slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
    for review_number in range(min(slot_count, len(intervals))):
        create_review_schedule(
            session,
            palace_id=palace_id,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor,
            anchor_date=anchor,
            completed=False,
        )
    session.commit()


def generate_schedule_for_palace(session, palace_id: int, algorithm: str) -> None:
    create_initial_review_schedules(session, palace_id, algorithm, anchor_date=date.today())


def infer_completed_stage_count(session, palace) -> int:
    from memory_anki.infrastructure.db.models import ReviewLog

    algorithm = next(
        (
            normalize_algorithm(schedule.algorithm_used)
            for schedule in (palace.review_schedules or [])
            if schedule.algorithm_used
        ),
        normalize_algorithm(get_config_value(session, "default_algorithm")),
    )
    intervals = get_algorithm_intervals(session, algorithm)
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
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


def _coerce_completed_at(value: datetime | None, fallback: datetime | None = None) -> datetime:
    target = value or fallback or datetime.now()
    return target.replace(second=0, microsecond=0)


def _collect_completed_stage_times(
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
        completed_at_by_stage[review_number] = _coerce_completed_at(
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


def ensure_current_review_schedule_model(session) -> int:
    from memory_anki.infrastructure.db.models import Palace

    palaces = session.query(Palace).all()
    changed = 0
    for palace in palaces:
        changed += _rebuild_palace_review_schedule_model(session, palace)

    session.commit()
    return changed


def ensure_palace_review_schedule_model(session, palace_id: int) -> int:
    from memory_anki.infrastructure.db.models import Palace

    palace = session.query(Palace).filter_by(id=palace_id).first()
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


def _select_preserved_schedule(schedules, palace, session):
    today = date.today()
    future_schedules = [
        schedule
        for schedule in schedules
        if schedule.scheduled_date and schedule.scheduled_date >= today
    ]
    if not future_schedules:
        return None
    return min(
        future_schedules,
        key=lambda schedule: (
            schedule.scheduled_date,
            0 if is_schedule_due(schedule, palace, session) else 1,
            schedule.id,
        ),
    )


def _rebuild_palace_review_schedule_model(session, palace) -> int:
    from memory_anki.infrastructure.db.models import ReviewSchedule

    schedules = sorted(
        list(palace.review_schedules or []),
        key=lambda schedule: (schedule.review_number, schedule.id),
    )
    algorithm = next(
        (
            normalize_algorithm(schedule.algorithm_used)
            for schedule in schedules
            if schedule.algorithm_used
        ),
        normalize_algorithm(get_config_value(session, "default_algorithm")),
    )
    intervals = get_algorithm_intervals(session, algorithm)
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
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
    anchor = _resolve_anchor_date(palace, schedules)
    completed_at_by_stage = _collect_completed_stage_times(
        schedules,
        completed_stage_count,
    )

    changed = 0
    if schedules:
        changed += len(schedules)
    session.query(ReviewSchedule).filter_by(palace_id=palace.id).delete(
        synchronize_session=False
    )
    session.flush()
    session.expire(palace, ['review_schedules'])

    palace.mastered = completed_stage_count >= len(intervals)

    previous_completed_at: datetime | None = None
    for review_number in range(completed_stage_count):
        stage_completed_at = _coerce_completed_at(
            completed_at_by_stage.get(review_number),
            previous_completed_at,
        )
        base_datetime = previous_completed_at if review_number >= initial_slot_count else None
        if create_review_schedule(
            session=session,
            palace_id=palace.id,
            review_number=review_number,
            algorithm=algorithm,
            base_date=anchor if base_datetime is None else base_datetime.date(),
            anchor_date=anchor,
            base_datetime=base_datetime,
            completed=True,
            completed_at=stage_completed_at,
        ):
            changed += 1
        previous_completed_at = stage_completed_at

    if not palace.mastered:
        for review_number in _target_pending_review_numbers(
            completed_count=completed_stage_count,
            total=len(intervals),
            initial_slot_count=initial_slot_count,
        ):
            preserved_schedule = _select_preserved_schedule(
                [
                    schedule
                    for schedule in schedules
                    if not schedule.completed and schedule.review_number == review_number
                ],
                palace,
                session,
            )
            base_datetime = previous_completed_at if review_number >= initial_slot_count else None
            created_schedule = create_review_schedule(
                session=session,
                palace_id=palace.id,
                review_number=review_number,
                algorithm=algorithm,
                base_date=anchor if base_datetime is None else base_datetime.date(),
                anchor_date=anchor,
                base_datetime=base_datetime,
                completed=False,
            )
            if created_schedule is None:
                continue
            if (
                preserved_schedule is not None
                and preserved_schedule.scheduled_date
                and preserved_schedule.scheduled_date >= date.today()
            ):
                created_schedule.scheduled_date = preserved_schedule.scheduled_date
                created_schedule.scheduled_at = getattr(preserved_schedule, "scheduled_at", None)
                created_schedule.interval_days = preserved_schedule.interval_days
                created_schedule.review_type = preserved_schedule.review_type
                created_schedule.anchor_date = preserved_schedule.anchor_date or anchor
            changed += 1

    session.flush()
    return changed


def update_all_pending_schedules(session, new_algorithm: str) -> None:
    from memory_anki.infrastructure.db.models import Palace, ReviewSchedule

    session.query(ReviewSchedule).delete()
    session.commit()
    for palace in session.query(Palace).all():
        generate_schedule_for_palace(session, palace.id, new_algorithm)


def migrate_sm2_to_ebbinghaus(session) -> None:
    from memory_anki.infrastructure.db.models import Config, ReviewSchedule

    default_algorithm = session.query(Config).filter_by(key="default_algorithm").first()
    if default_algorithm and default_algorithm.value == "sm2":
        default_algorithm.value = "ebbinghaus"

    pending_schedules = session.query(ReviewSchedule).filter(ReviewSchedule.algorithm_used == "sm2").all()
    for schedule in pending_schedules:
        schedule.algorithm_used = "ebbinghaus"

    session.commit()
