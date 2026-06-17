from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Config,
    EnglishCourse,
    EnglishCourseProgress,
    Palace,
    TimeRecord,
)

TIME_RECORD_DASHBOARD_KINDS = ("review", "practice", "quiz", "palace_edit")


def get_threshold_seconds(session: Session) -> int:
    row = session.query(Config).filter_by(key="time_recording_threshold_seconds").first()
    if row is None:
        return 0
    try:
        return max(0, int(row.value))
    except Exception:
        return 0


def get_today_total_review_duration_seconds(session: Session) -> int:
    start, end = _today_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_today_formal_review_duration_seconds(session: Session) -> int:
    start, end = _today_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=("review",),
        start=start,
        end=end,
    )


def get_weekly_total_review_duration_seconds(session: Session) -> int:
    start, end = _current_week_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_monthly_total_review_duration_seconds(session: Session) -> int:
    start, end = _current_month_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_selected_total_review_duration_seconds(
    session: Session,
    *,
    start: datetime,
    end: datetime,
) -> int:
    return get_time_record_duration_seconds(
        session,
        kinds=TIME_RECORD_DASHBOARD_KINDS,
        start=start,
        end=end,
    )


def get_all_time_total_review_duration_seconds(session: Session) -> int:
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind.in_(TIME_RECORD_DASHBOARD_KINDS),
            TimeRecord.effective_seconds > threshold,
        )
        .all()
    )
    return sum(record.effective_seconds for record in records)


def get_weekly_formal_review_duration_seconds(session: Session) -> int:
    start, end = _current_week_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=("review",),
        start=start,
        end=end,
    )


def get_today_palace_learning_breakdown(session: Session) -> list[dict[str, Any]]:
    start, end = _today_bounds()
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind.in_(TIME_RECORD_DASHBOARD_KINDS),
            TimeRecord.effective_seconds > threshold,
            TimeRecord.palace_id.is_not(None),
            TimeRecord.started_at >= start,
            TimeRecord.started_at < end,
        )
        .order_by(TimeRecord.started_at.asc(), TimeRecord.id.asc())
        .all()
    )
    palace_ids = {
        int(record.palace_id)
        for record in records
        if record.palace_id is not None
    }
    palace_rows = (
        session.query(Palace)
        .filter(Palace.id.in_(palace_ids))
        .all()
        if palace_ids
        else []
    )
    palace_titles = {int(palace.id): palace.title or "未命名宫殿" for palace in palace_rows}
    grouped: dict[int, dict[str, Any]] = {}
    for record in records:
        palace_id = int(record.palace_id)
        payload = grouped.setdefault(
            palace_id,
            {
                "palace_id": palace_id,
                "palace_title": palace_titles.get(palace_id) or record.title or "未命名宫殿",
                "total_seconds": 0,
                "review_seconds": 0,
                "practice_seconds": 0,
                "palace_edit_seconds": 0,
            },
        )
        seconds = max(0, int(record.effective_seconds or 0))
        payload["total_seconds"] += seconds
        if record.kind == "review":
            payload["review_seconds"] += seconds
        elif record.kind == "practice":
            payload["practice_seconds"] += seconds
        elif record.kind == "quiz":
            payload["practice_seconds"] += seconds
        elif record.kind == "palace_edit":
            payload["palace_edit_seconds"] += seconds
        elif not payload["palace_title"] and record.title:
            payload["palace_title"] = record.title

    return sorted(
        grouped.values(),
        key=lambda item: (-int(item["total_seconds"]), str(item["palace_title"])),
    )


def get_today_english_practice_duration_seconds(session: Session) -> int:
    start, end = _today_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=("practice",),
        start=start,
        end=end,
        source_kind="english",
    )


def get_weekly_english_practice_duration_seconds(session: Session) -> int:
    start, end = _current_week_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=("practice",),
        start=start,
        end=end,
        source_kind="english",
    )


def get_all_time_english_practice_duration_seconds(session: Session) -> int:
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind == "practice",
            TimeRecord.effective_seconds > threshold,
            TimeRecord.source_kind == "english",
        )
        .all()
    )
    return sum(record.effective_seconds for record in records)


def get_today_english_reading_duration_seconds(session: Session) -> int:
    start, end = _today_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=("practice",),
        start=start,
        end=end,
        source_kind="english_reading",
    )


def get_weekly_english_reading_duration_seconds(session: Session) -> int:
    start, end = _current_week_bounds()
    return get_time_record_duration_seconds(
        session,
        kinds=("practice",),
        start=start,
        end=end,
        source_kind="english_reading",
    )


def get_all_time_english_reading_duration_seconds(session: Session) -> int:
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind == "practice",
            TimeRecord.effective_seconds > threshold,
            TimeRecord.source_kind == "english_reading",
        )
        .all()
    )
    return sum(record.effective_seconds for record in records)


def get_english_course_stats(session: Session) -> dict[str, int]:
    total_courses = session.query(EnglishCourse).count()
    completed_courses = (
        session.query(EnglishCourseProgress)
        .filter(EnglishCourseProgress.is_completed.is_(True))
        .count()
    )
    unfinished_courses = max(0, total_courses - completed_courses)
    today_practice_seconds = get_today_english_practice_duration_seconds(session)
    weekly_practice_seconds = get_weekly_english_practice_duration_seconds(session)
    total_practice_seconds = get_all_time_english_practice_duration_seconds(session)
    today_reading_seconds = get_today_english_reading_duration_seconds(session)
    weekly_reading_seconds = get_weekly_english_reading_duration_seconds(session)
    total_reading_seconds = get_all_time_english_reading_duration_seconds(session)
    return {
        "total_courses": total_courses,
        "unfinished_courses": unfinished_courses,
        "completed_courses": completed_courses,
        "today_practice_seconds": today_practice_seconds,
        "weekly_practice_seconds": weekly_practice_seconds,
        "total_practice_seconds": total_practice_seconds,
        "today_reading_seconds": today_reading_seconds,
        "weekly_reading_seconds": weekly_reading_seconds,
        "total_reading_seconds": total_reading_seconds,
        "today_total_seconds": today_practice_seconds + today_reading_seconds,
        "weekly_total_seconds": weekly_practice_seconds + weekly_reading_seconds,
        "total_seconds": total_practice_seconds + total_reading_seconds,
    }


def get_time_record_duration_seconds(
    session: Session,
    *,
    kinds: tuple[str, ...],
    start: datetime,
    end: datetime,
    source_kind: str | None = None,
) -> int:
    threshold = get_threshold_seconds(session)
    query = session.query(TimeRecord).filter(
        TimeRecord.deleted_at.is_(None),
        TimeRecord.kind.in_(kinds),
        TimeRecord.effective_seconds > threshold,
        TimeRecord.started_at >= start,
        TimeRecord.started_at < end,
    )
    if source_kind is not None:
        query = query.filter(TimeRecord.source_kind == source_kind)
    records = query.all()
    return sum(record.effective_seconds for record in records)


def _today_bounds() -> tuple[datetime, datetime]:
    start = datetime.combine(date.today(), time.min)
    end = start + timedelta(days=1)
    return start, end


def _current_week_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start = datetime.combine(today - timedelta(days=today.weekday()), time.min)
    end = start + timedelta(days=7)
    return start, end


def _current_month_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start = datetime.combine(today.replace(day=1), time.min)
    end = _start_of_next_month(today.replace(day=1))
    return start, end


def month_bounds(target: date) -> tuple[datetime, datetime]:
    start_of_month = target.replace(day=1)
    start = datetime.combine(start_of_month, time.min)
    end = _start_of_next_month(start_of_month)
    return start, end


def date_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    start = datetime.combine(start_date, time.min)
    end = datetime.combine(end_date + timedelta(days=1), time.min)
    return start, end


def _start_of_next_month(start_of_month: date) -> datetime:
    if start_of_month.month == 12:
        next_month = date(start_of_month.year + 1, 1, 1)
    else:
        next_month = date(start_of_month.year, start_of_month.month + 1, 1)
    return datetime.combine(next_month, time.min)
