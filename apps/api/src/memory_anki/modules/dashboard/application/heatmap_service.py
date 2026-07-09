"""Daily study heatmap and streak aggregation."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewLog

MAX_HEATMAP_DAYS = 366
DEFAULT_HEATMAP_DAYS = 182


def build_heatmap_payload(session: Session, days: int = DEFAULT_HEATMAP_DAYS) -> dict:
    days = max(7, min(int(days), MAX_HEATMAP_DAYS))
    today = date.today()
    start = today - timedelta(days=days - 1)
    start_dt = datetime.combine(start, time.min)

    review_rows = (
        session.query(
            ReviewLog.review_date,
            func.count(ReviewLog.id),
            func.coalesce(func.sum(ReviewLog.duration_seconds), 0),
        )
        .join(Palace, Palace.id == ReviewLog.palace_id)
        .filter(
            ReviewLog.review_date >= start,
            ReviewLog.review_date <= today,
            Palace.deleted_at.is_(None),
        )
        .group_by(ReviewLog.review_date)
        .all()
    )
    session_day = func.date(StudySession.started_at)
    session_rows = (
        session.query(
            session_day,
            func.coalesce(func.sum(StudySession.effective_seconds), 0),
        )
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.started_at >= start_dt,
            StudySession.effective_seconds > 0,
        )
        .group_by(session_day)
        .all()
    )

    by_day: dict[str, dict] = {}
    for review_date, count, duration in review_rows:
        if review_date is None:
            continue
        key = review_date.isoformat()
        entry = by_day.setdefault(key, {"review_count": 0, "study_seconds": 0})
        entry["review_count"] = int(count)
        entry["study_seconds"] += int(duration)
    for day_value, seconds in session_rows:
        key = str(day_value)
        entry = by_day.setdefault(key, {"review_count": 0, "study_seconds": 0})
        entry["study_seconds"] += int(seconds)

    items = []
    active_days: set[str] = set()
    for offset in range(days):
        day = start + timedelta(days=offset)
        key = day.isoformat()
        entry = by_day.get(key, {"review_count": 0, "study_seconds": 0})
        active = entry["review_count"] > 0 or entry["study_seconds"] > 0
        if active:
            active_days.add(key)
        items.append(
            {
                "date": key,
                "review_count": entry["review_count"],
                "study_seconds": entry["study_seconds"],
                "active": active,
            }
        )

    current_streak = 0
    cursor = today
    if today.isoformat() not in active_days:
        cursor = today - timedelta(days=1)
    while cursor >= start and cursor.isoformat() in active_days:
        current_streak += 1
        cursor -= timedelta(days=1)

    longest_streak = 0
    run = 0
    for item in items:
        run = run + 1 if item["active"] else 0
        longest_streak = max(longest_streak, run)

    return {
        "start_date": start.isoformat(),
        "end_date": today.isoformat(),
        "items": items,
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "active_day_count": len(active_days),
    }
