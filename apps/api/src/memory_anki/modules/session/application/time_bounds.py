from __future__ import annotations

from datetime import date, datetime, timedelta

from memory_anki.core.time import (
    local_calendar_day_bounds_as_utc_naive,
    resolve_local_timezone,
)


def _today_local() -> date:
    """Today on the resolved local calendar, never the raw process clock."""
    return datetime.now(resolve_local_timezone()).date()


def _day_start(day: date) -> datetime:
    """Local midnight for ``day`` as UTC-naive, via the resolved zone."""
    return local_calendar_day_bounds_as_utc_naive(day)[0]


def today_bounds() -> tuple[datetime, datetime]:
    """Half-open local calendar day expressed as UTC-naive bounds."""
    return local_calendar_day_bounds_as_utc_naive(_today_local())


def current_week_bounds() -> tuple[datetime, datetime]:
    """Monday 00:00 local → next Monday 00:00 local, as UTC-naive."""
    today = _today_local()
    week_start = today - timedelta(days=today.weekday())
    return _day_start(week_start), _day_start(week_start + timedelta(days=7))


def current_month_bounds() -> tuple[datetime, datetime]:
    today = _today_local()
    return month_bounds(today.replace(day=1))


def month_bounds(target: date) -> tuple[datetime, datetime]:
    start_of_month = target.replace(day=1)
    return _day_start(start_of_month), _day_start(_start_of_next_month_date(start_of_month))


def date_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    """Inclusive local calendar dates → half-open UTC-naive datetime bounds."""
    return _day_start(start_date), _day_start(end_date + timedelta(days=1))


def _start_of_next_month_date(start_of_month: date) -> date:
    if start_of_month.month == 12:
        return date(start_of_month.year + 1, 1, 1)
    return date(start_of_month.year, start_of_month.month + 1, 1)
