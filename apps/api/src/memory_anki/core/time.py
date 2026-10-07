from __future__ import annotations

import logging
import os
import re
from datetime import UTC, date, datetime, time, timedelta, timezone, tzinfo
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger(__name__)

LOCAL_TZ_ENV = "MEMORY_ANKI_LOCAL_TZ"
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
    UTC-aware ledger path. One explicit zone keeps day bucketing deterministic.

    ``MEMORY_ANKI_LOCAL_TZ`` accepts an IANA name (``Asia/Shanghai``), a fixed
    offset (``UTC``, ``+08:00``), or a Windows zone id, so a headless server can
    pin the calendar without changing the machine's own timezone setting.
    """
    configured = os.environ.get(LOCAL_TZ_ENV, "").strip()
    if configured:
        resolved = _parse_configured_zone(configured)
        if resolved is not None:
            return resolved
        logger.warning(
            "Ignoring invalid %s=%r; falling back to the OS local timezone.",
            LOCAL_TZ_ENV,
            configured,
        )
    # astimezone() with no argument returns the host zone on aware datetimes.
    return datetime.now().astimezone().tzinfo or UTC


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
    """Local calendar day of an instant stored as UTC-naive or aware."""
    zone = tz or resolve_local_timezone()
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(zone).date()


def local_calendar_day_bounds_as_utc_naive(
    day: date | None = None,
    tz: tzinfo | None = None,
) -> tuple[datetime, datetime]:
    """Half-open [local midnight, next local midnight) as UTC-naive.

    The zone is resolved explicitly rather than inherited from the raw process
    clock, so every caller shares one calendar rule.
    """
    target = day or date.today()
    zone = tz or resolve_local_timezone()
    start_local = datetime.combine(target, time.min, tzinfo=zone)
    end_local = datetime.combine(target + timedelta(days=1), time.min, tzinfo=zone)
    return (
        start_local.astimezone(UTC).replace(tzinfo=None),
        end_local.astimezone(UTC).replace(tzinfo=None),
    )


def local_calendar_day_start_as_utc_naive(day: date | None = None) -> datetime:
    """Local midnight of ``day`` as UTC-naive (for comparing with utc_now_naive rows).

    Kept as a thin wrapper so existing callers share the resolved zone instead of
    relying on the process clock that ``astimezone()`` would otherwise use.
    """
    return local_calendar_day_bounds_as_utc_naive(day)[0]


__all__ = [
    "LOCAL_TZ_ENV",
    "ensure_utc_naive",
    "iso_utc_now",
    "iso_utc_now_naive",
    "local_calendar_day_bounds_as_utc_naive",
    "local_calendar_day_of",
    "local_calendar_day_start_as_utc_naive",
    "parse_api_datetime",
    "parse_client_datetime",
    "resolve_local_timezone",
    "to_api_datetime",
    "utc_now",
    "utc_now_naive",
]
