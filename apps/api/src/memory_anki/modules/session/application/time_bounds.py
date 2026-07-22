from __future__ import annotations

from datetime import date, datetime, timedelta

from memory_anki.core.time import (
    local_calendar_day_bounds_as_utc_naive,
    local_calendar_day_start_as_utc_naive,
)


def today_bounds() -> tuple[datetime, datetime]:
    """Half-open local calendar day expressed as UTC-naive bounds."""
    return local_calendar_day_bounds_as_utc_naive()


def current_week_bounds() -> tuple[datetime, datetime]:
    """Monday 00:00 local → next Monday 00:00 local, as UTC-naive."""
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    start = local_calendar_day_start_as_utc_naive(week_start)
    end = local_calendar_day_start_as_utc_naive(week_start + timedelta(days=7))
    return start, end


def current_month_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    return month_bounds(today.replace(day=1))


def month_bounds(target: date) -> tuple[datetime, datetime]:
    start_of_month = target.replace(day=1)
    start = local_calendar_day_start_as_utc_naive(start_of_month)
    end = local_calendar_day_start_as_utc_naive(_start_of_next_month_date(start_of_month))
    return start, end


def date_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    """Inclusive local calendar dates → half-open UTC-naive datetime bounds."""
    start = local_calendar_day_start_as_utc_naive(start_date)
    end = local_calendar_day_start_as_utc_naive(end_date + timedelta(days=1))
    return start, end


def _start_of_next_month_date(start_of_month: date) -> date:
    if start_of_month.month == 12:
        return date(start_of_month.year + 1, 1, 1)
    return date(start_of_month.year, start_of_month.month + 1, 1)
