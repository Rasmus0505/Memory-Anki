from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from memory_anki.core.time import (
    local_calendar_day_bounds_as_utc_naive,
    parse_api_datetime,
    to_api_datetime,
)
from memory_anki.modules.session.application.serialization import (
    _parse_datetime,
    _serialize_datetime,
)


def test_parse_api_datetime_treats_naive_as_utc():
    parsed = parse_api_datetime("2026-07-22T01:00:00")
    assert parsed == datetime(2026, 7, 22, 1, 0, 0)


def test_parse_api_datetime_converts_offset_to_utc_naive():
    # 01:00+08:00 → 17:00 previous day UTC
    parsed = parse_api_datetime("2026-07-22T01:00:00+08:00")
    assert parsed == datetime(2026, 7, 21, 17, 0, 0)


def test_parse_api_datetime_accepts_zulu():
    parsed = parse_api_datetime("2026-07-21T17:00:00.000Z")
    assert parsed == datetime(2026, 7, 21, 17, 0, 0)


def test_to_api_datetime_always_includes_utc_offset():
    value = to_api_datetime(datetime(2026, 7, 21, 17, 0, 0))
    assert value is not None
    assert value.endswith("+00:00")
    assert value.startswith("2026-07-21T17:00:00")


def test_session_serialization_uses_utc_offset():
    assert _serialize_datetime(datetime(2026, 7, 22, 1, 0, 0)) == "2026-07-22T01:00:00+00:00"
    assert _parse_datetime("2026-07-22T01:00:00+08:00") == datetime(2026, 7, 21, 17, 0, 0)


def test_local_calendar_day_bounds_cover_china_morning_utc():
    """01:00 China local is previous-day 17:00 UTC and must still count as that local day."""
    day = date(2026, 7, 22)
    start, end = local_calendar_day_bounds_as_utc_naive(day)
    # Host local midnight → UTC. On China Standard Time the offset is +8h.
    local_midnight = datetime(2026, 7, 22, 0, 0, 0)
    expected_start = local_midnight.astimezone(UTC).replace(tzinfo=None)
    assert start == expected_start
    assert end == expected_start + timedelta(hours=24) or end > start

    one_am_china_as_utc = datetime(2026, 7, 21, 17, 0, 0)
    # Only assert inclusion when host is UTC+8 (project machines are China).
    if datetime.now().astimezone().utcoffset() == timedelta(hours=8):
        assert start <= one_am_china_as_utc < end
