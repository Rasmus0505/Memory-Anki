"""Local calendar bounds shared by dashboard read models (UTC-naive, half-open)."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from memory_anki.core.time import local_calendar_day_bounds_as_utc_naive, resolve_local_timezone


def _today_local() -> date:
    return datetime.now(resolve_local_timezone()).date()


def today_bounds() -> tuple[datetime, datetime]:
    return local_calendar_day_bounds_as_utc_naive(_today_local())


def date_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    """Inclusive local calendar dates to half-open UTC-naive datetime bounds."""
    return (
        local_calendar_day_bounds_as_utc_naive(start_date)[0],
        local_calendar_day_bounds_as_utc_naive(end_date + timedelta(days=1))[0],
    )
