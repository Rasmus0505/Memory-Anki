from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_now_naive() -> datetime:
    return utc_now().replace(tzinfo=None)


def iso_utc_now(timespec: str = "auto") -> str:
    return utc_now().isoformat(timespec=timespec)


def iso_utc_now_naive() -> str:
    return utc_now_naive().isoformat()


def ensure_utc_naive(value: datetime) -> datetime:
    """Normalize any datetime to UTC-naive storage form."""
    if value.tzinfo is None:
        return value.replace(tzinfo=None)
    return value.astimezone(UTC).replace(tzinfo=None)


def parse_api_datetime(raw: Any) -> datetime | None:
    """Parse API/client datetime strings into UTC-naive storage.

    - Explicit offsets (including ``Z``) are converted to UTC then stripped.
    - Naive values are treated as UTC (matching ``utc_now_naive`` storage).
    """
    if raw in (None, ""):
        return None
    if isinstance(raw, datetime):
        return ensure_utc_naive(raw)
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ensure_utc_naive(parsed)


def to_api_datetime(value: datetime | None, *, timespec: str = "auto") -> str | None:
    """Serialize datetimes for JSON APIs as UTC with an explicit offset.

    Naive values are treated as UTC (matching ``utc_now_naive`` storage).
    Always include ``+00:00`` so clients never misread UTC as local wall time.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        aware = value.replace(tzinfo=UTC)
    else:
        aware = value.astimezone(UTC)
    return aware.isoformat(timespec=timespec)


def local_calendar_day_start_as_utc_naive(day: date | None = None) -> datetime:
    """Local midnight of ``day`` as UTC-naive (for comparing with utc_now_naive rows)."""
    target = day or date.today()
    local_midnight = datetime.combine(target, time.min)
    # Naive datetimes are interpreted as local wall time by astimezone().
    return local_midnight.astimezone(UTC).replace(tzinfo=None)


def local_calendar_day_bounds_as_utc_naive(
    day: date | None = None,
) -> tuple[datetime, datetime]:
    """Half-open [local midnight, next local midnight) in UTC-naive."""
    target = day or date.today()
    start = local_calendar_day_start_as_utc_naive(target)
    end = local_calendar_day_start_as_utc_naive(target + timedelta(days=1))
    return start, end
