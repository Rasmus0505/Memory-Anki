from __future__ import annotations

import logging
import os
import re
from datetime import UTC, date, datetime, time, timedelta, timezone, tzinfo
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger(__name__)

LOCAL_TZ_ENV = "MEMORY_ANKI_LOCAL_TZ"
STUDY_DAY_START_HOUR_ENV = "MEMORY_ANKI_DAY_START_HOUR"
# A study day starts at 03:00 local time, not 00:00. Studying at 00:30 belongs
# to the evening that just ended, so the due queue must not roll forward yet.
DEFAULT_STUDY_DAY_START_HOUR = 3
# Matches a trailing ``Z`` or ``±HH:MM`` / ``±HHMM`` offset on an ISO datetime.
_HAS_OFFSET_PATTERN = re.compile(r"(?:Z|[+-]\d{2}:?\d{2})$", re.IGNORECASE)


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

    A naive client string is a contract violation: it cannot be distinguished
    from a UTC one, so a wrong guess shifts the record by the offset. Callers
    that ingest untrusted client payloads should use
    :func:`parse_client_datetime` instead, which rejects the ambiguity.
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


def parse_client_datetime(raw: Any) -> datetime | None:
    """Parse a client-supplied instant, rejecting offset-less ambiguity.

    Returns ``None`` for naive input so the caller can fail the request instead
    of silently inventing a zone. Naive values were the root of the mixed
    UTC/local convention: the same string meant UTC in storage and local wall
    time in the browser.
    """
    if raw in (None, ""):
        return None
    if isinstance(raw, datetime):
        if raw.tzinfo is None:
            return None
        return ensure_utc_naive(raw)
    text = str(raw).strip()
    if not text:
        return None
    # datetime.fromisoformat accepts offset-less strings; screen them first.
    if not _HAS_OFFSET_PATTERN.search(text):
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
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


def resolve_local_timezone() -> tzinfo:
    """The one local calendar zone the backend is allowed to use.

    Every "which local day is this?" decision must go through this function
    instead of SQLite's ``datetime(column, 'localtime')``. The SQLite modifier
    depends on the *server process* OS timezone, which is not the learner's zone
    once the API runs anywhere else, and it silently disagreed with the
    UTC-aware path. One explicit zone keeps day bucketing deterministic.

    ``MEMORY_ANKI_LOCAL_TZ`` accepts an IANA name (``Asia/Shanghai``), a fixed
    offset (``UTC``, ``+08:00``), or a Windows zone id. When it is unset, the
    calendar is Beijing time (UTC+8), not the process OS zone.
    """
    configured = os.environ.get(LOCAL_TZ_ENV, "").strip()
    if configured:
        resolved = _parse_configured_zone(configured)
        if resolved is not None:
            return resolved
        logger.warning(
            "Ignoring invalid %s=%r; falling back to Beijing time.",
            LOCAL_TZ_ENV,
            configured,
        )
    # This product's two devices share one lived calendar: Beijing time.
    # Falling back to the process OS zone made the same evening land on
    # different days when one machine was left on UTC.
    return timezone(timedelta(hours=8))


def study_day_start_hour() -> int:
    """Local hour (0-23) at which a new study day begins.

    The learner studies past midnight; a 03:00 rollover keeps the small hours
    attached to the evening's day, so ``忘记`` / ``困难`` retries and the due
    queue keep speaking about the same day the session started on.
    ``MEMORY_ANKI_DAY_START_HOUR`` overrides the default; invalid values fall
    back to 03:00 like an invalid zone falls back to Beijing time.
    """
    configured = os.environ.get(STUDY_DAY_START_HOUR_ENV, "").strip()
    if configured:
        try:
            hour = int(configured)
        except ValueError:
            hour = -1
        if 0 <= hour <= 23:
            return hour
        logger.warning(
            "Ignoring invalid %s=%r; falling back to %02d:00.",
            STUDY_DAY_START_HOUR_ENV,
            configured,
            DEFAULT_STUDY_DAY_START_HOUR,
        )
    return DEFAULT_STUDY_DAY_START_HOUR


def study_day_of(value: datetime, tz: tzinfo | None = None) -> date:
    """Study day of an instant stored as UTC-naive or aware.

    The study day is the local calendar date shifted back by
    :func:`study_day_start_hour`; between midnight and that hour the answer is
    still the previous calendar day.
    """
    zone = tz or resolve_local_timezone()
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    local = value.astimezone(zone)
    return (local - timedelta(hours=study_day_start_hour())).date()


def local_day(tz_name: str | None = None) -> date:
    """Current study day in the request zone, or the product zone when absent."""
    if not tz_name:
        return study_day_of(utc_now(), resolve_local_timezone())
    try:
        zone = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"invalid timezone: {tz_name}") from exc
    return study_day_of(utc_now(), zone)


def _parse_configured_zone(value: str) -> tzinfo | None:
    """Parse ``MEMORY_ANKI_LOCAL_TZ``; return None when it is unusable."""
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.upper() == "UTC":
        return UTC
    # Fixed offsets do not need a tzdata entry, which Windows Python may lack.
    match = re.fullmatch(r"(?P<sign>[+-])(?P<hours>\d{1,2})(?::?(?P<minutes>\d{2}))?", normalized)
    if match:
        sign = 1 if match.group("sign") == "+" else -1
        delta = timedelta(
            hours=int(match.group("hours")),
            minutes=int(match.group("minutes") or 0),
        )
        return timezone(sign * delta)
    try:
        return ZoneInfo(normalized)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return None


def local_calendar_day_of(value: datetime, tz: tzinfo | None = None) -> date:
    """Study day of an instant. See :func:`study_day_of`."""
    return study_day_of(value, tz)


def local_calendar_day_bounds_as_utc_naive(
    day: date | None = None,
    tz: tzinfo | None = None,
) -> tuple[datetime, datetime]:
    """Half-open [study day start, next study day start) as UTC-naive.

    With the default 03:00 rollover the window for day ``D`` is
    ``[D 03:00, D+1 03:00)`` local time, so 00:15 belongs to the previous day.
    The zone is resolved explicitly rather than inherited from the raw process
    clock, so every caller shares one calendar rule.
    """
    zone = tz or resolve_local_timezone()
    start_hour = study_day_start_hour()
    target = day or study_day_of(utc_now(), zone)
    start_local = datetime.combine(target, time(hour=start_hour), tzinfo=zone)
    end_local = datetime.combine(target + timedelta(days=1), time(hour=start_hour), tzinfo=zone)
    return (
        start_local.astimezone(UTC).replace(tzinfo=None),
        end_local.astimezone(UTC).replace(tzinfo=None),
    )


def local_calendar_day_start_as_utc_naive(day: date | None = None) -> datetime:
    """Start of study day ``day`` as UTC-naive (for comparing with utc_now_naive rows).

    Kept as a thin wrapper so existing callers share the resolved zone instead of
    relying on the process clock that ``astimezone()`` would otherwise use.
    """
    return local_calendar_day_bounds_as_utc_naive(day)[0]


__all__ = [
    "DEFAULT_STUDY_DAY_START_HOUR",
    "LOCAL_TZ_ENV",
    "STUDY_DAY_START_HOUR_ENV",
    "ensure_utc_naive",
    "iso_utc_now",
    "iso_utc_now_naive",
    "local_calendar_day_bounds_as_utc_naive",
    "local_calendar_day_of",
    "local_calendar_day_start_as_utc_naive",
    "local_day",
    "parse_api_datetime",
    "parse_client_datetime",
    "resolve_local_timezone",
    "study_day_of",
    "study_day_start_hour",
    "to_api_datetime",
    "utc_now",
    "utc_now_naive",
]
