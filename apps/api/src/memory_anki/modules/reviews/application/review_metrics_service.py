"""Review metrics and duration queries."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewLog
from memory_anki.modules.sessions.api import (
    STUDY_DASHBOARD_SCENES,
    get_study_session_duration_seconds,
)


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
        .join(Palace, Palace.id == ReviewLog.palace_id)
        .filter(
            ReviewLog.review_date >= start,
            ReviewLog.review_date <= today,
            Palace.deleted_at.is_(None),
        )
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
    logs = (
        session.query(ReviewLog)
        .join(Palace, Palace.id == ReviewLog.palace_id)
        .filter(
            ReviewLog.review_date == today,
            Palace.deleted_at.is_(None),
        )
        .all()
    )
    return sum(log.duration_seconds for log in logs)


def get_weekly_formal_review_duration_seconds(session: Session) -> int:
    return get_weekly_stats(session)["review_duration_seconds"]


def get_today_practice_duration_seconds(session: Session) -> int:
    today = date.today()
    start = datetime.combine(today, datetime.min.time())
    end = start + timedelta(days=1)
    return get_study_session_duration_seconds(
        session,
        scenes=STUDY_DASHBOARD_SCENES,
        start=start,
        end=end,
    )


def get_weekly_practice_duration_seconds(session: Session) -> int:
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())
    start = datetime.combine(start_of_week, datetime.min.time())
    end = datetime.combine(today + timedelta(days=1), datetime.min.time())
    return get_study_session_duration_seconds(
        session,
        scenes=STUDY_DASHBOARD_SCENES,
        start=start,
        end=end,
    )


def get_review_load_forecast(session: Session, days: int = 7) -> dict:
    """Future daily review load plus the current overdue backlog."""
    from sqlalchemy import func

    from memory_anki.infrastructure.db._tables.palaces import ReviewSchedule

    days = max(1, min(int(days), 60))
    today = date.today()
    end = today + timedelta(days=days - 1)

    rows = (
        session.query(
            ReviewSchedule.scheduled_date,
            func.count(ReviewSchedule.id),
        )
        .join(Palace, ReviewSchedule.palace_id == Palace.id)
        .filter(
            ReviewSchedule.completed == False,  # noqa: E712
            Palace.archived == False,  # noqa: E712
            Palace.mastered == False,  # noqa: E712
            Palace.deleted_at.is_(None),
            ReviewSchedule.scheduled_date <= end,
        )
        .group_by(ReviewSchedule.scheduled_date)
        .all()
    )

    overdue_count = 0
    by_date: dict[str, int] = {}
    for scheduled_date, count in rows:
        if scheduled_date is None:
            continue
        if scheduled_date < today:
            overdue_count += int(count)
        else:
            by_date[scheduled_date.isoformat()] = int(count)

    items = []
    for offset in range(days):
        day = today + timedelta(days=offset)
        key = day.isoformat()
        items.append(
            {
                "date": key,
                "due_count": by_date.get(key, 0),
                "is_today": offset == 0,
            }
        )

    return {
        "days": days,
        "overdue_count": overdue_count,
        "total_upcoming": sum(item["due_count"] for item in items),
        "items": items,
    }


def list_recent_review_notes(session: Session, limit: int = 20) -> list[dict]:
    safe_limit = max(1, min(int(limit or 20), 100))
    rows = (
        session.query(ReviewLog, Palace)
        .join(Palace, Palace.id == ReviewLog.palace_id)
        .filter(
            ReviewLog.note != "",
            Palace.deleted_at.is_(None),
        )
        .order_by(ReviewLog.id.desc())
        .limit(safe_limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "palace_id": log.palace_id,
            "palace_title": palace.manual_title or palace.title,
            "review_date": log.review_date.isoformat() if log.review_date else None,
            "note": log.note,
        }
        for log, palace in rows
    ]
