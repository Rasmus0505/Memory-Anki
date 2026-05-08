"""Review scheduling and queue services."""

from datetime import date, timedelta

from sqlalchemy.orm import Session

from models import Chapter, Palace, ReviewLog, ReviewSchedule
from services.palace_service import restore_archived_palaces
from services.schedule_service import (
    compute_next_review,
    custom_intervals,
    ebbinghaus_intervals,
    generate_schedule_for_palace,
    get_config_value,
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


def get_next_due_review(
    session: Session,
    exclude_schedule_id: int | None = None,
    chapter_id: int | None = None,
) -> ReviewSchedule | None:
    query = _due_query(session, chapter_id=chapter_id)
    if exclude_schedule_id is not None:
        query = query.filter(ReviewSchedule.id != exclude_schedule_id)
    return query.first()


def get_overdue_count(session: Session) -> int:
    restore_archived_palaces(session)
    today = date.today()
    return (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date < today,
            ReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .count()
    )


def get_due_count(session: Session) -> int:
    restore_archived_palaces(session)
    today = date.today()
    return (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.scheduled_date <= today,
            ReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .count()
    )


def spread_overdue(session: Session, days: int = 7) -> int:
    """Spread overdue items across the next N days."""
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
    reviews = get_today_reviews(session, chapter_id=chapter_id, respect_daily_limit=chapter_id is None)
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


def map_rating_to_score(rating: str | None, fallback_score: int | None = None) -> int:
    mapping = {
        "forgot": 0,
        "fuzzy": 3,
        "remembered": 5,
    }
    if rating in mapping:
        return mapping[rating]
    if fallback_score is not None:
        return fallback_score
    return 0


def submit_review(
    session: Session,
    schedule_id: int,
    score: int,
    duration_seconds: int = 0,
) -> tuple[ReviewLog | None, dict]:
    """Return (log, extra_info)."""
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return None, {}

    today = date.today()
    log = ReviewLog(
        palace_id=schedule.palace_id,
        review_date=today,
        score=score,
        review_mode="review",
        duration_seconds=duration_seconds,
    )
    session.add(log)
    schedule.completed = True

    from services.schedule_service import use_anchor

    algorithm = schedule.algorithm_used
    anchor = schedule.anchor_date if use_anchor(session) else None
    actual_interval = (today - schedule.scheduled_date).days
    effective_interval = max(schedule.interval_days, actual_interval)
    next_interval, next_date, review_type, algorithm_used = compute_next_review(
        session,
        algorithm,
        schedule.review_number + 1,
        effective_interval,
        score,
        anchor,
    )

    completed_count = (
        session.query(ReviewSchedule)
        .filter_by(palace_id=schedule.palace_id, completed=True)
        .count()
    )

    extra: dict[str, bool] = {}
    intervals: list[str] = []
    if algorithm == "ebbinghaus":
        intervals = ebbinghaus_intervals(session)
    elif algorithm == "custom":
        intervals = custom_intervals(session)

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
            anchor_date=schedule.anchor_date,
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
    average_score = sum(log.score for log in logs) / total if total > 0 else 0
    return {
        "total_reviews": total,
        "average_score": round(average_score, 1),
        "last_review": logs[-1].review_date.isoformat() if logs else None,
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
    completed = sum(1 for log in logs if log.score >= 3)
    return {
        "total": total,
        "completed": completed,
        "completion_rate": round(completed / total * 100) if total > 0 else 0,
        "avg_score": round(sum(log.score for log in logs) / total, 1) if total > 0 else 0,
    }


def trigger_review_for_palace(session: Session, palace_id: int) -> None:
    existing = session.query(ReviewSchedule).filter_by(palace_id=palace_id).first()
    if existing:
        return
    algorithm = get_config_value(session, "default_algorithm")
    generate_schedule_for_palace(session, palace_id, algorithm)
