"""Review queue queries and read-side payload assembly."""

from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Chapter,
    Palace,
    PalaceSegment,
    PalaceSegmentReviewSchedule,
    ReviewSchedule,
)
from memory_anki.modules.palaces.application.palace_service import restore_archived_palaces
from memory_anki.modules.palaces.application.segment_review_service import (
    estimate_segment_review_seconds,
    is_segment_schedule_due,
    is_segment_schedule_overdue,
    segment_summary_json,
)
from memory_anki.modules.reviews.application.review_metrics_service import (
    get_weekly_stats,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_config_value,
    is_schedule_due,
    is_schedule_overdue,
    schedule_display_datetime,
)


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


def _segment_due_query(
    session: Session,
    chapter_id: int | None = None,
) -> list[PalaceSegmentReviewSchedule]:
    restore_archived_palaces(session)
    query = (
        session.query(PalaceSegmentReviewSchedule)
        .join(PalaceSegment)
        .join(Palace)
        .filter(
            PalaceSegmentReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .order_by(
            PalaceSegmentReviewSchedule.review_number,
            PalaceSegmentReviewSchedule.id,
        )
    )
    if chapter_id is not None:
        query = query.filter(Palace.chapters.any(Chapter.id == chapter_id))
    schedules = query.all()
    now = datetime.now()
    return [
        schedule
        for schedule in schedules
        if schedule.segment
        and schedule.segment.palace
        and is_segment_schedule_due(session, schedule.segment, schedule, now=now)
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


def _group_segment_due_reviews(
    reviews: list[PalaceSegmentReviewSchedule],
    session: Session,
    respect_daily_limit: bool = True,
    daily_limit: int = 0,
) -> list[dict]:
    grouped: OrderedDict[int, dict] = OrderedDict()
    for schedule in reviews:
        segment_id = schedule.palace_segment_id
        group = grouped.get(segment_id)
        if group is None:
            if respect_daily_limit and daily_limit > 0 and len(grouped) >= daily_limit:
                continue
            group = {
                "schedule": schedule,
                "schedule_count": 0,
                "overdue_schedule_count": 0,
                "next_due_date": schedule.scheduled_date,
            }
            grouped[segment_id] = group

        group["schedule_count"] += 1
        if schedule.segment and schedule.segment.palace and is_segment_schedule_overdue(
            session,
            schedule.segment,
            schedule,
        ):
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


def get_segment_review_groups(
    session: Session,
    chapter_id: int | None = None,
    respect_daily_limit: bool = True,
) -> list[dict]:
    reviews = _segment_due_query(session, chapter_id=chapter_id)
    if chapter_id is not None:
        respect_daily_limit = False
    max_per_day = int(get_config_value(session, "daily_max_reviews") or "0")
    return _group_segment_due_reviews(
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


def get_next_due_segment_review(
    session: Session,
    exclude_schedule_id: int | None = None,
    chapter_id: int | None = None,
) -> PalaceSegmentReviewSchedule | None:
    reviews = _segment_due_query(session, chapter_id=chapter_id)
    excluded_segment_id: int | None = None
    if exclude_schedule_id is not None:
        excluded_schedule = (
            session.query(PalaceSegmentReviewSchedule)
            .filter_by(id=exclude_schedule_id)
            .first()
        )
        excluded_segment_id = excluded_schedule.palace_segment_id if excluded_schedule else None

    groups = _group_segment_due_reviews(reviews, session, respect_daily_limit=False)
    for group in groups:
        schedule = group["schedule"]
        if excluded_segment_id is not None and schedule.palace_segment_id == excluded_segment_id:
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


def get_segment_overdue_count(session: Session) -> int:
    restore_archived_palaces(session)
    schedules = (
        session.query(PalaceSegmentReviewSchedule)
        .join(PalaceSegment)
        .join(Palace)
        .filter(
            PalaceSegmentReviewSchedule.completed == False,
            Palace.mastered == False,
        )
        .all()
    )
    now = datetime.now()
    overdue_segment_ids = {
        schedule.palace_segment_id
        for schedule in schedules
        if schedule.segment
        and schedule.segment.palace
        and is_segment_schedule_overdue(session, schedule.segment, schedule, now=now)
    }
    return len(overdue_segment_ids)


def get_due_count(session: Session) -> int:
    return len(get_today_review_groups(session))


def get_segment_due_count(session: Session) -> int:
    return len(get_segment_review_groups(session))


def _palace_has_started_review_progress(palace: Palace | None) -> bool:
    if palace is None:
        return False
    if any(bool(getattr(schedule, "completed", False)) for schedule in (palace.review_schedules or [])):
        return True
    return any(
        getattr(log, "review_mode", "") == "review"
        for log in (palace.review_logs or [])
    )


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
        if schedule.palace
        and is_schedule_overdue(schedule, schedule.palace, session, now=now)
        and _palace_has_started_review_progress(schedule.palace)
    ]
    if not overdue or days <= 0:
        return 0

    per_day = max(1, len(overdue) // days)
    for index, schedule in enumerate(overdue):
        offset = index // per_day
        next_date = today + timedelta(days=min(offset, days - 1))
        previous_due_at = (
            schedule_display_datetime(schedule, schedule.palace, session)
            if schedule.palace
            else None
        )
        schedule.scheduled_date = next_date
        if previous_due_at is not None:
            schedule.scheduled_at = datetime.combine(next_date, previous_due_at.time())
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


def get_segment_review_queue_payload(
    session: Session,
    chapter_id: int | None = None,
) -> dict:
    smoothed_count = maybe_auto_smooth_overdue(session)
    reviews = get_segment_review_groups(
        session,
        chapter_id=chapter_id,
        respect_daily_limit=chapter_id is None,
    )
    return {
        "due_count": len(reviews),
        "overdue_count": get_segment_overdue_count(session),
        "smoothed_count": smoothed_count,
        "stats": get_weekly_stats(session),
        "reviews": reviews,
    }


def get_chapter_queue_payload(session: Session, chapter_id: int) -> dict:
    chapter = session.query(Chapter).filter_by(id=chapter_id).first()
    payload = get_review_queue_payload(session, chapter_id=chapter_id)
    payload["chapter"] = chapter
    return payload


def get_segment_chapter_queue_payload(session: Session, chapter_id: int) -> dict:
    chapter = session.query(Chapter).filter_by(id=chapter_id).first()
    payload = get_segment_review_queue_payload(session, chapter_id=chapter_id)
    payload["chapter"] = chapter
    return payload


def segment_schedule_json(
    schedule: PalaceSegmentReviewSchedule,
    session: Session,
) -> dict[str, object]:
    summary = segment_summary_json(session, schedule.segment) if schedule.segment else None
    return {
        "id": schedule.id,
        "palace_segment_id": schedule.palace_segment_id,
        "palace_id": schedule.segment.palace_id if schedule.segment else None,
        "scheduled_date": schedule.scheduled_date.isoformat(),
        "interval_days": schedule.interval_days,
        "algorithm_used": schedule.algorithm_used,
        "completed": schedule.completed,
        "completed_at": schedule.completed_at.isoformat(timespec="minutes")
        if schedule.completed_at
        else None,
        "review_number": schedule.review_number,
        "review_type": schedule.review_type,
        "segment": summary,
        "estimated_review_seconds": (
            estimate_segment_review_seconds(schedule.segment)
            if schedule.segment
            else 0
        ),
    }
