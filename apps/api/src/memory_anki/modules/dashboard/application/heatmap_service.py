"""Daily study heatmap and streak aggregation."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_start_as_utc_naive
from memory_anki.modules.session.public.queries import get_time_record_daily_totals

MAX_HEATMAP_DAYS = 366
DEFAULT_HEATMAP_DAYS = 182


def build_heatmap_payload(session: Session, days: int = DEFAULT_HEATMAP_DAYS) -> dict:
    days = max(7, min(int(days), MAX_HEATMAP_DAYS))
    today = date.today()
    start = today - timedelta(days=days - 1)
    start_dt = local_calendar_day_start_as_utc_naive(start)
    end_dt = local_calendar_day_start_as_utc_naive(today + timedelta(days=1))
    review_rows = get_time_record_daily_totals(
        session, start=start_dt, end=end_dt, kind="review"
    )
    session_rows = get_time_record_daily_totals(session, start=start_dt, end=end_dt)

    by_day: dict[str, dict] = {}
    for review_date, _seconds, count in review_rows:
        key = str(review_date)
        entry = by_day.setdefault(key, {"review_count": 0, "study_seconds": 0})
        entry["review_count"] = int(count)
    for day_value, seconds, _records in session_rows:
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
