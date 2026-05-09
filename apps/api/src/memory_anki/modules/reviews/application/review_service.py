"""Review scheduling and queue services."""

from collections import OrderedDict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter, Palace, ReviewLog, ReviewSchedule
from memory_anki.modules.palaces.application.palace_service import restore_archived_palaces
from memory_anki.modules.reviews.application.schedule_service import (
    compute_next_review,
    custom_intervals,
    ebbinghaus_intervals,
    generate_schedule_for_palace,
    get_config_value,
    normalize_algorithm,
)


def _due_query(session: Session, chapter_id: int | None = None):
    restore_archived_palaces(session)
    today = date.today()
    query = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date <= today,
            ReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .order_by(
            ReviewSchedule.review_type != "standard",
            ReviewSchedule.scheduled_date,
            ReviewSchedule.id,
        )
    )
    if chapter_id is not None:
        query = query.filter(Palace.chapters.any(Chapter.id == chapter_id))
    return query


def _group_due_reviews(
    reviews: list[ReviewSchedule],
    respect_daily_limit: bool = True,
    daily_limit: int = 0,
) -> list[dict]:
    grouped: OrderedDict[int, dict] = OrderedDict()
    for schedule in reviews:
        palace_id = schedule.palace_id
        group = grouped.get(palace_id)
        if group is None:
            if respect_daily_limit and daily_limit > 0 and len(grouped) >= daily_limit:
                continue
            group = {
                "schedule": schedule,
                "schedule_count": 0,
                "overdue_schedule_count": 0,
                "next_due_date": schedule.scheduled_date,
            }
            grouped[palace_id] = group

        group["schedule_count"] += 1
        if schedule.scheduled_date < date.today():
            group["overdue_schedule_count"] += 1
        if schedule.scheduled_date < group["next_due_date"]:
            group["next_due_date"] = schedule.scheduled_date
            group["schedule"] = schedule
    return list(grouped.values())


def get_today_reviews(
    session: Session,
    chapter_id: int | None = None,
    respect_daily_limit: bool = True,
) -> list[ReviewSchedule]:
    query = _due_query(session, chapter_id=chapter_id)
    if chapter_id is not None:
        respect_daily_limit = False
    max_per_day = int(get_config_value(session, "daily_max_reviews") or "0")
    if respect_daily_limit and max_per_day > 0:
        return query.limit(max_per_day).all()
    return query.all()


def get_today_review_groups(
    session: Session,
    chapter_id: int | None = None,
    respect_daily_limit: bool = True,
) -> list[dict]:
    query = _due_query(session, chapter_id=chapter_id)
    if chapter_id is not None:
        respect_daily_limit = False
    max_per_day = int(get_config_value(session, "daily_max_reviews") or "0")
    reviews = query.all()
    return _group_due_reviews(
        reviews,
        respect_daily_limit=respect_daily_limit,
        daily_limit=max_per_day,
    )


def get_next_due_review(
    session: Session,
    exclude_schedule_id: int | None = None,
    chapter_id: int | None = None,
) -> ReviewSchedule | None:
    reviews = _due_query(session, chapter_id=chapter_id).all()
    excluded_palace_id: int | None = None
    if exclude_schedule_id is not None:
        excluded_schedule = session.query(ReviewSchedule).filter_by(id=exclude_schedule_id).first()
        excluded_palace_id = excluded_schedule.palace_id if excluded_schedule else None

    groups = _group_due_reviews(reviews, respect_daily_limit=False)
    for group in groups:
        schedule = group["schedule"]
        if excluded_palace_id is not None and schedule.palace_id == excluded_palace_id:
            continue
        return schedule
    return None


def get_overdue_count(session: Session) -> int:
    restore_archived_palaces(session)
    today = date.today()
    overdue_palace_ids = (
        session.query(ReviewSchedule.palace_id)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date < today,
            ReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .distinct()
        .all()
    )
    return len(overdue_palace_ids)


def get_due_count(session: Session) -> int:
    return len(get_today_review_groups(session))


def spread_overdue(session: Session, days: int = 7) -> int:
    restore_archived_palaces(session)
    today = date.today()
    overdue = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date < today,
            ReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .order_by(ReviewSchedule.scheduled_date, ReviewSchedule.id)
        .all()
    )
    if not overdue or days <= 0:
        return 0

    per_day = max(1, len(overdue) // days)
    for index, schedule in enumerate(overdue):
        offset = index // per_day
        schedule.scheduled_date = today + timedelta(days=min(offset, days - 1))
    session.commit()
    return len(overdue)


def maybe_auto_smooth_overdue(session: Session) -> int:
    enabled = get_config_value(session, "auto_smooth_overdue") == "true"
    if not enabled:
        return 0
    threshold = int(get_config_value(session, "overdue_smoothing_threshold") or "0")
    days = int(get_config_value(session, "overdue_smoothing_days") or "7")
    overdue_count = get_overdue_count(session)
    if overdue_count <= 0 or days <= 0:
        return 0
    if threshold > 0 and overdue_count < threshold:
        return 0
    return spread_overdue(session, days)


def get_review_queue_payload(session: Session, chapter_id: int | None = None) -> dict:
    smoothed_count = maybe_auto_smooth_overdue(session)
    reviews = get_today_review_groups(
        session,
        chapter_id=chapter_id,
        respect_daily_limit=chapter_id is None,
    )
    return {
        "due_count": len(reviews),
        "overdue_count": get_overdue_count(session),
        "smoothed_count": smoothed_count,
        "stats": get_weekly_stats(session),
        "reviews": reviews,
    }


def get_chapter_queue_payload(session: Session, chapter_id: int) -> dict:
    chapter = session.query(Chapter).filter_by(id=chapter_id).first()
    payload = get_review_queue_payload(session, chapter_id=chapter_id)
    payload["chapter"] = chapter
    return payload


def submit_review(
    session: Session,
    schedule_id: int,
    duration_seconds: int = 0,
) -> tuple[ReviewLog | None, dict]:
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return None, {}

    today = date.today()
    due_batch = (
        session.query(ReviewSchedule)
        .filter(
            ReviewSchedule.palace_id == schedule.palace_id,
            ReviewSchedule.scheduled_date <= today,
            ReviewSchedule.completed == False,
        )
        .order_by(ReviewSchedule.review_number.desc(), ReviewSchedule.scheduled_date.desc(), ReviewSchedule.id.desc())
        .all()
    )
    if not due_batch:
        return None, {}

    latest_schedule = due_batch[0]
    log = ReviewLog(
        palace_id=schedule.palace_id,
        review_date=today,
        score=5,
        review_mode="review",
        duration_seconds=duration_seconds,
    )
    session.add(log)
    for due_schedule in due_batch:
        due_schedule.completed = True

    from memory_anki.modules.reviews.application.schedule_service import use_anchor

    algorithm = normalize_algorithm(latest_schedule.algorithm_used)
    anchor = latest_schedule.anchor_date if use_anchor(session) else None
    actual_interval = (today - latest_schedule.scheduled_date).days
    effective_interval = max(latest_schedule.interval_days, actual_interval)
    next_interval, next_date, review_type, algorithm_used = compute_next_review(
        session,
        algorithm,
        latest_schedule.review_number + 1,
        effective_interval,
        anchor,
    )

    completed_count = (
        session.query(ReviewSchedule)
        .filter_by(palace_id=schedule.palace_id, completed=True)
        .count()
    )

    extra: dict[str, bool] = {}
    intervals: list[str] = custom_intervals(session) if algorithm == "custom" else ebbinghaus_intervals(session)

    if intervals and completed_count >= len(intervals):
        schedule.palace.mastered = True
        extra["mastered"] = True
    else:
        next_schedule = ReviewSchedule(
            palace_id=schedule.palace_id,
            scheduled_date=next_date,
            interval_days=next_interval,
            algorithm_used=algorithm_used,
            review_number=completed_count,
            review_type=review_type,
            anchor_date=latest_schedule.anchor_date,
        )
        session.add(next_schedule)

    session.commit()
    session.refresh(log)
    return log, extra


def get_palace_stats(session: Session, palace_id: int) -> dict:
    logs = (
        session.query(ReviewLog)
        .filter_by(palace_id=palace_id)
        .order_by(ReviewLog.review_date)
        .all()
    )
    total = len(logs)
    total_duration = sum(log.duration_seconds for log in logs)
    last_review = logs[-1].review_date if logs else None
    return {
        "total_reviews": total,
        "total_duration_seconds": total_duration,
        "last_review": last_review.isoformat() if last_review else None,
    }


def get_weekly_stats(session: Session) -> dict:
    today = date.today()
    start = today - timedelta(days=today.weekday())
    logs = (
        session.query(ReviewLog)
        .filter(ReviewLog.review_date >= start, ReviewLog.review_date <= today)
        .all()
    )
    total = len(logs)
    total_duration = sum(log.duration_seconds for log in logs)
    return {
        "total": total,
        "review_count": total,
        "review_duration_seconds": total_duration,
    }


def trigger_review_for_palace(session: Session, palace_id: int) -> None:
    existing = session.query(ReviewSchedule).filter_by(palace_id=palace_id).first()
    if existing:
        return
    algorithm = get_config_value(session, "default_algorithm")
    generate_schedule_for_palace(session, palace_id, algorithm)
