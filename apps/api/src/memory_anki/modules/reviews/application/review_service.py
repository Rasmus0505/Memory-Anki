"""Review scheduling and queue services."""

from collections import OrderedDict
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Chapter,
    Palace,
    PalaceSegment,
    PalaceSegmentReviewSchedule,
    ReviewLog,
    ReviewSchedule,
    TimeRecord,
)
from memory_anki.modules.palaces.application.palace_service import restore_archived_palaces
from memory_anki.modules.palaces.application.segment_service import (
    build_segments_editor_doc,
    create_segment_review_log,
    ensure_segment_schedule_model,
    estimate_segment_review_seconds,
    is_segment_schedule_due,
    is_segment_schedule_overdue,
    segment_summary_json,
)
from memory_anki.modules.reviews.application.schedule_service import (
    create_initial_review_schedules,
    create_review_schedule,
    ensure_palace_review_schedule_model,
    get_algorithm_intervals,
    get_config_value,
    is_schedule_due,
    is_schedule_overdue,
    normalize_algorithm,
    schedule_display_datetime,
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


def _segment_due_query(session: Session, chapter_id: int | None = None) -> list[PalaceSegmentReviewSchedule]:
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
        if schedule.segment and schedule.segment.palace and is_segment_schedule_due(session, schedule.segment, schedule, now=now)
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
        if schedule.segment and schedule.segment.palace and is_segment_schedule_overdue(session, schedule.segment, schedule):
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
        excluded_schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=exclude_schedule_id).first()
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
        if schedule.segment and schedule.segment.palace and is_segment_schedule_overdue(session, schedule.segment, schedule, now=now)
    }
    return len(overdue_segment_ids)


def get_due_count(session: Session) -> int:
    return len(get_today_review_groups(session))


def get_segment_due_count(session: Session) -> int:
    return len(get_segment_review_groups(session))


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
        next_date = today + timedelta(days=min(offset, days - 1))
        previous_due_at = schedule_display_datetime(schedule, schedule.palace, session) if schedule.palace else None
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


def get_segment_review_queue_payload(session: Session, chapter_id: int | None = None) -> dict:
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
    schedule.completed = True
    schedule.completed_at = completed_at
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
                base_datetime=completed_at,
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
        palace_segment_id=None,
        title=palace.title if palace else "未命名宫殿",
        duration_seconds=duration_seconds,
        ended_at=completed_at,
        completion_method=completion_mode or "manual_complete",
    )
    session.commit()
    session.refresh(log)
    return log, extra


def submit_segment_review(
    session: Session,
    schedule_id: int,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
) -> tuple[PalaceSegmentReviewSchedule | None, dict]:
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule or not schedule.segment:
        return None, {}
    segment = schedule.segment
    ensure_segment_schedule_model(session, segment)
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule or not schedule.segment or not schedule.segment.palace:
        return None, {}

    if not is_segment_schedule_due(session, schedule.segment, schedule):
        return None, {}

    completed_at = datetime.now().replace(second=0, microsecond=0)
    today = completed_at.date()
    segment = schedule.segment
    create_segment_review_log(
        session,
        segment=segment,
        duration_seconds=duration_seconds,
        completed_at=completed_at,
    )
    schedule.completed = True
    schedule.completed_at = completed_at
    extra: dict[str, bool] = {}
    algorithm = normalize_algorithm(schedule.algorithm_used)
    intervals = get_algorithm_intervals(session, algorithm)
    next_review_number = schedule.review_number + 1

    if next_review_number < len(intervals):
        existing_next_schedule = (
            session.query(PalaceSegmentReviewSchedule)
            .filter(
                PalaceSegmentReviewSchedule.palace_segment_id == segment.id,
                PalaceSegmentReviewSchedule.completed == False,
                PalaceSegmentReviewSchedule.review_number == next_review_number,
            )
            .order_by(PalaceSegmentReviewSchedule.id.asc())
            .first()
        )
        if existing_next_schedule is None:
            next_schedule = create_review_schedule(
                session=session,
                palace_id=segment.palace_id,
                review_number=next_review_number,
                algorithm=algorithm,
                base_date=today,
                anchor_date=schedule.anchor_date or today,
                base_datetime=completed_at,
                completed=False,
            )
            if next_schedule is not None:
                session.add(
                    PalaceSegmentReviewSchedule(
                        palace_segment_id=segment.id,
                        scheduled_date=next_schedule.scheduled_date,
                        scheduled_at=next_schedule.scheduled_at,
                        interval_days=next_schedule.interval_days,
                        algorithm_used=next_schedule.algorithm_used,
                        completed=False,
                        review_number=next_schedule.review_number,
                        review_type=next_schedule.review_type,
                        anchor_date=next_schedule.anchor_date,
                    )
                )
                session.expunge(next_schedule)

    session.flush()
    create_review_time_record(
        session,
        record_id=f"segment-review-log-{schedule.id}-{int(completed_at.timestamp())}",
        palace_id=segment.palace_id,
        palace_segment_id=segment.id,
        title=f"{segment.palace.title} / {segment.name}",
        duration_seconds=duration_seconds,
        ended_at=completed_at,
        completion_method=completion_mode or "manual_complete",
    )
    session.commit()
    session.refresh(schedule)
    return schedule, extra


def build_batch_segment_review_session(
    session: Session,
    segment_ids: list[int],
) -> dict[str, Any]:
    normalized_segment_ids = []
    for segment_id in segment_ids:
        try:
            value = int(segment_id)
        except (TypeError, ValueError):
            continue
        if value > 0 and value not in normalized_segment_ids:
            normalized_segment_ids.append(value)
    if not normalized_segment_ids:
        raise ValueError("请选择至少一个分块。")

    segments = (
        session.query(PalaceSegment)
        .filter(PalaceSegment.id.in_(normalized_segment_ids))
        .all()
    )
    segment_map = {segment.id: segment for segment in segments}
    ordered_segments = [segment_map.get(segment_id) for segment_id in normalized_segment_ids]
    if any(segment is None for segment in ordered_segments):
        raise ValueError("包含不存在的分块。")

    palace_ids = {segment.palace_id for segment in ordered_segments if segment is not None}
    if len(palace_ids) != 1:
        raise ValueError("只能同时复习同一宫殿下的分块。")

    summaries = []
    selected_node_uid_lists: list[list[str]] = []
    for segment in ordered_segments:
        ensure_segment_schedule_model(session, segment)
        summary = segment_summary_json(session, segment)
        if not summary["has_due_review"] or not summary["current_review_schedule_id"]:
            raise ValueError("只能选择当前到期且可开始复习的分块。")
        summaries.append(summary)
        selected_node_uid_lists.append(summary["node_uids"])

    palace = ordered_segments[0].palace if ordered_segments else None
    if palace is None:
        raise ValueError("当前分块未关联宫殿。")

    estimated_review_seconds = sum(
        max(0, int(summary.get("estimated_review_seconds") or 0))
        for summary in summaries
    )

    return {
        "palace": {
            "id": palace.id,
            "title": palace.title,
            "description": palace.description,
        },
        "segments": summaries,
        "editor_doc": build_segments_editor_doc(palace, selected_node_uid_lists),
        "estimated_review_seconds": estimated_review_seconds,
    }


def submit_batch_segment_review(
    session: Session,
    segment_ids: list[int],
    *,
    duration_seconds: int = 0,
    completion_mode: str = "manual_complete",
) -> dict[str, Any]:
    payload = build_batch_segment_review_session(session, segment_ids)
    summaries = payload["segments"]
    if not summaries:
        raise ValueError("请选择至少一个分块。")

    normalized_duration = max(0, int(duration_seconds))
    segment_count = len(summaries)
    per_segment_duration = normalized_duration // segment_count if segment_count > 0 else 0
    duration_remainder = normalized_duration % segment_count if segment_count > 0 else 0

    completed_segment_ids: list[int] = []
    for index, summary in enumerate(summaries):
        schedule_id = int(summary["current_review_schedule_id"])
        schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
        if not schedule or not schedule.segment or not schedule.segment.palace:
            raise ValueError("存在不可用的分块复习任务。")
        if not is_segment_schedule_due(session, schedule.segment, schedule):
            raise ValueError("所选分块中包含未到期任务。")
        current_duration = per_segment_duration + (1 if index < duration_remainder else 0)
        submitted_schedule, _ = submit_segment_review(
            session,
            schedule_id,
            duration_seconds=current_duration,
            completion_mode=completion_mode,
        )
        if not submitted_schedule:
            raise ValueError("提交多块复习失败。")
        completed_segment_ids.append(schedule.segment.id)

    return {
        "ok": True,
        "completed_segment_ids": completed_segment_ids,
        "completion_mode": completion_mode,
    }


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


def segment_schedule_json(schedule: PalaceSegmentReviewSchedule, session: Session) -> dict[str, Any]:
    summary = segment_summary_json(session, schedule.segment) if schedule.segment else None
    return {
        "id": schedule.id,
        "palace_segment_id": schedule.palace_segment_id,
        "palace_id": schedule.segment.palace_id if schedule.segment else None,
        "scheduled_date": schedule.scheduled_date.isoformat(),
        "interval_days": schedule.interval_days,
        "algorithm_used": schedule.algorithm_used,
        "completed": schedule.completed,
        "completed_at": schedule.completed_at.isoformat(timespec="minutes") if schedule.completed_at else None,
        "review_number": schedule.review_number,
        "review_type": schedule.review_type,
        "segment": summary,
        "estimated_review_seconds": estimate_segment_review_seconds(schedule.segment) if schedule.segment else 0,
    }
