"""Review scheduling and queue services."""

from collections import OrderedDict
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter, Palace, ReviewLog, ReviewSchedule, TimeRecord
from memory_anki.modules.palaces.application.palace_service import restore_archived_palaces
from memory_anki.modules.reviews.application.schedule_service import (
    create_initial_review_schedules,
    create_review_schedule,
    ensure_palace_review_schedule_model,
    get_algorithm_intervals,
    get_config_value,
    is_schedule_due,
    is_schedule_overdue,
    normalize_algorithm,
)
from memory_anki.modules.time_records.application.time_records_service import create_review_time_record


def _due_query(session: Session, chapter_id: int | None = None) -> list[ReviewSchedule]:
    restore_archived_palaces(session)
    query = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .order_by(
            ReviewSchedule.review_number,
            ReviewSchedule.id,
        )
    )
    if chapter_id is not None:
        query = query.filter(Palace.chapters.any(Chapter.id == chapter_id))
    schedules = query.all()
    now = datetime.now()
    return [
        schedule
        for schedule in schedules
        if schedule.palace and is_schedule_due(schedule, schedule.palace, session, now=now)
    ]


def _group_due_reviews(
    reviews: list[ReviewSchedule],
    session: Session,
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
        if schedule.palace and is_schedule_overdue(schedule, schedule.palace, session):
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
    reviews = _due_query(session, chapter_id=chapter_id)
    if chapter_id is not None:
        respect_daily_limit = False
    max_per_day = int(get_config_value(session, "daily_max_reviews") or "0")
    if respect_daily_limit and max_per_day > 0:
        return reviews[:max_per_day]
    return reviews


def get_today_review_groups(
    session: Session,
    chapter_id: int | None = None,
    respect_daily_limit: bool = True,
) -> list[dict]:
    reviews = _due_query(session, chapter_id=chapter_id)
    if chapter_id is not None:
        respect_daily_limit = False
    max_per_day = int(get_config_value(session, "daily_max_reviews") or "0")
    return _group_due_reviews(
        reviews,
        session,
        respect_daily_limit=respect_daily_limit,
        daily_limit=max_per_day,
    )


def get_next_due_review(
    session: Session,
    exclude_schedule_id: int | None = None,
    chapter_id: int | None = None,
) -> ReviewSchedule | None:
    reviews = _due_query(session, chapter_id=chapter_id)
    excluded_palace_id: int | None = None
    if exclude_schedule_id is not None:
        excluded_schedule = session.query(ReviewSchedule).filter_by(id=exclude_schedule_id).first()
        excluded_palace_id = excluded_schedule.palace_id if excluded_schedule else None

    groups = _group_due_reviews(reviews, session, respect_daily_limit=False)
    for group in groups:
        schedule = group["schedule"]
        if excluded_palace_id is not None and schedule.palace_id == excluded_palace_id:
            continue
        return schedule
    return None


def get_overdue_count(session: Session) -> int:
    restore_archived_palaces(session)
    schedules = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .all()
    )
    now = datetime.now()
    overdue_palace_ids = {
        schedule.palace_id
        for schedule in schedules
        if schedule.palace and is_schedule_overdue(schedule, schedule.palace, session, now=now)
    }
    return len(overdue_palace_ids)


def get_due_count(session: Session) -> int:
    return len(get_today_review_groups(session))


def spread_overdue(session: Session, days: int = 7) -> int:
    restore_archived_palaces(session)
    today = date.today()
    candidates = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .order_by(ReviewSchedule.scheduled_date, ReviewSchedule.id)
        .all()
    )
    now = datetime.now()
    overdue = [
        schedule
        for schedule in candidates
        if schedule.palace and is_schedule_overdue(schedule, schedule.palace, session, now=now)
    ]
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
    completion_mode: str = "manual_complete",
) -> tuple[ReviewLog | None, dict]:
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return None, {}
    ensure_palace_review_schedule_model(session, schedule.palace_id)
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return None, {}

    if not schedule.palace or not is_schedule_due(schedule, schedule.palace, session):
        return None, {}

    today = date.today()
    palace = schedule.palace
    log = ReviewLog(
        palace_id=schedule.palace_id,
        review_date=today,
        score=5,
        review_mode="review",
        duration_seconds=duration_seconds,
    )
    session.add(log)
    schedule.completed = True
    extra: dict[str, bool] = {}
    algorithm = normalize_algorithm(schedule.algorithm_used)
    intervals = get_algorithm_intervals(session, algorithm)
    next_review_number = schedule.review_number + 1

    if next_review_number >= len(intervals):
        palace.mastered = True
        extra["mastered"] = True
    else:
        existing_next_schedule = (
            session.query(ReviewSchedule)
            .filter(
                ReviewSchedule.palace_id == schedule.palace_id,
                ReviewSchedule.completed == False,
                ReviewSchedule.review_number == next_review_number,
            )
            .order_by(ReviewSchedule.id.asc())
            .first()
        )
        if existing_next_schedule is None:
            next_schedule = create_review_schedule(
                session=session,
                palace_id=schedule.palace_id,
                review_number=next_review_number,
                algorithm=algorithm,
                base_date=today,
                anchor_date=schedule.anchor_date or today,
                completed=False,
            )
            if next_schedule is None:
                palace.mastered = True
                extra["mastered"] = True

    session.flush()
    create_review_time_record(
        session,
        record_id=f"review-log-{log.id}",
        palace_id=schedule.palace_id,
        title=palace.title if palace else "未命名宫殿",
        duration_seconds=duration_seconds,
        ended_at=datetime.now(),
        completion_method=completion_mode or "manual_complete",
    )
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


def get_today_formal_review_duration_seconds(session: Session) -> int:
    today = date.today()
    logs = session.query(ReviewLog).filter(ReviewLog.review_date == today).all()
    return sum(log.duration_seconds for log in logs)


def get_weekly_formal_review_duration_seconds(session: Session) -> int:
    return get_weekly_stats(session)["review_duration_seconds"]


def get_today_practice_duration_seconds(session: Session) -> int:
    today = date.today()
    start = datetime.combine(today, datetime.min.time())
    end = start + timedelta(days=1)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.started_at >= start,
            TimeRecord.started_at < end,
        )
        .all()
    )
    return sum(record.effective_seconds for record in records)


def get_weekly_practice_duration_seconds(session: Session) -> int:
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())
    start = datetime.combine(start_of_week, datetime.min.time())
    end = datetime.combine(today + timedelta(days=1), datetime.min.time())
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.started_at >= start,
            TimeRecord.started_at < end,
        )
        .all()
    )
    return sum(record.effective_seconds for record in records)


def trigger_review_for_palace(session: Session, palace_id: int) -> None:
    existing = session.query(ReviewSchedule).filter_by(palace_id=palace_id).first()
    if existing:
        return
    algorithm = get_config_value(session, "default_algorithm")
    create_initial_review_schedules(session, palace_id, algorithm)
