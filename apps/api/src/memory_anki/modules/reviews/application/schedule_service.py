"""Review schedule policies."""

from datetime import date, timedelta


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


def compute_next_review(
    session,
    algorithm: str,
    review_number: int,
    prev_interval: int,
    anchor_date: date | None = None,
) -> tuple[int, date, str, str]:
    normalized_algorithm = normalize_algorithm(algorithm)
    intervals = custom_intervals(session) if normalized_algorithm == "custom" else ebbinghaus_intervals(session)

    if not intervals:
        intervals = ["1", "2", "4", "7", "15", "30", "60"]

    value = intervals[-1] if review_number >= len(intervals) else intervals[review_number]
    return resolve_interval(value, anchor_date, normalized_algorithm)


def generate_schedule_for_palace(session, palace_id: int, algorithm: str) -> None:
    from memory_anki.infrastructure.db.models import ReviewSchedule

    today = date.today()
    normalized_algorithm = normalize_algorithm(algorithm)
    intervals = custom_intervals(session) if normalized_algorithm == "custom" else ebbinghaus_intervals(session)
    if not intervals:
        intervals = ["1", "2", "4", "7", "15", "30", "60"]

    for index, value in enumerate(intervals):
        interval_days, scheduled_date, review_type, algorithm_used = resolve_interval(value, today, normalized_algorithm)
        schedule = ReviewSchedule(
            palace_id=palace_id,
            scheduled_date=scheduled_date,
            interval_days=interval_days,
            algorithm_used=algorithm_used,
            review_number=index,
            review_type=review_type,
            anchor_date=today,
        )
        session.add(schedule)
    session.commit()


def update_all_pending_schedules(session, new_algorithm: str) -> None:
    from memory_anki.infrastructure.db.models import Palace, ReviewSchedule

    session.query(ReviewSchedule).filter_by(completed=False).delete()
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
