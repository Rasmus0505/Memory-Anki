"""Review metrics and duration queries."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import ReviewLog, TimeRecord


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
