from __future__ import annotations

from datetime import date, datetime, time, timedelta


def today_bounds() -> tuple[datetime, datetime]:
    start = datetime.combine(date.today(), time.min)
    return start, start + timedelta(days=1)


def current_week_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start = datetime.combine(today - timedelta(days=today.weekday()), time.min)
    return start, start + timedelta(days=7)


def current_month_bounds() -> tuple[datetime, datetime]:
    today = date.today()
    start = datetime.combine(today.replace(day=1), time.min)
    return start, _start_of_next_month(today.replace(day=1))


def month_bounds(target: date) -> tuple[datetime, datetime]:
    start_of_month = target.replace(day=1)
    return datetime.combine(start_of_month, time.min), _start_of_next_month(start_of_month)


def date_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    return datetime.combine(start_date, time.min), datetime.combine(end_date + timedelta(days=1), time.min)


def _start_of_next_month(start_of_month: date) -> datetime:
    if start_of_month.month == 12:
        next_month = date(start_of_month.year + 1, 1, 1)
    else:
        next_month = date(start_of_month.year, start_of_month.month + 1, 1)
    return datetime.combine(next_month, time.min)
