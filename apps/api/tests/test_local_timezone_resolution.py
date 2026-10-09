"""One explicit local zone for every calendar-day decision.

Regression guard for the mixed convention where SQLite's ``'localtime'``
modifier followed the server process zone while the UTC-aware ledger path
resolved the zone in Python. The two silently disagreed off the China host.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from memory_anki.core.time import (
    LOCAL_TZ_ENV,
    local_calendar_day_bounds_as_utc_naive,
    local_calendar_day_of,
    local_calendar_day_start_as_utc_naive,
    parse_client_datetime,
    resolve_local_timezone,
)
from memory_anki.modules.session.application import time_bounds
from memory_anki.modules.session.application import time_record_read_model as read_model


@pytest.fixture
def zone_env(monkeypatch):
    def apply(value: str | None):
        if value is None:
            monkeypatch.delenv(LOCAL_TZ_ENV, raising=False)
        else:
            monkeypatch.setenv(LOCAL_TZ_ENV, value)

    return apply


def test_configured_fixed_offset_is_honoured(zone_env):
    zone_env("+08:00")
    assert resolve_local_timezone().utcoffset(None) == timedelta(hours=8)


def test_configured_utc_keyword_is_honoured(zone_env):
    zone_env("UTC")
    assert resolve_local_timezone().utcoffset(None) == timedelta(0)


@pytest.mark.parametrize("value", ["+0800", "+08:00", "+08"])
def test_offset_accepts_common_spellings(zone_env, value):
    zone_env(value)
    assert resolve_local_timezone().utcoffset(None) == timedelta(hours=8)


def test_unset_zone_uses_beijing_time(zone_env):
    zone_env(None)
    assert resolve_local_timezone().utcoffset(None) == timedelta(hours=8)


def test_invalid_zone_falls_back_instead_of_raising(zone_env):
    zone_env("Not/AZone")
    # Must not raise: a bad override cannot be allowed to break time recording.
    assert resolve_local_timezone() is not None


def test_day_bounds_follow_the_configured_zone(zone_env):
    zone_env("+08:00")
    start, end = local_calendar_day_bounds_as_utc_naive(date(2026, 10, 7))
    # 2026-10-07 00:00 +08:00 == 2026-10-06 16:00 UTC
    assert start == datetime(2026, 10, 6, 16, 0)
    assert end == datetime(2026, 10, 7, 16, 0)


def test_same_instant_maps_to_different_local_day_per_zone(zone_env):
    instant = datetime(2026, 10, 6, 20, 58)  # UTC-naive storage form
    zone_env("UTC")
    assert local_calendar_day_of(instant) == date(2026, 10, 6)
    zone_env("+08:00")
    assert local_calendar_day_of(instant) == date(2026, 10, 7)


def test_day_start_is_consistent_with_day_bounds(zone_env):
    zone_env("+08:00")
    day = date(2026, 10, 7)
    assert local_calendar_day_start_as_utc_naive(day) == (
        local_calendar_day_bounds_as_utc_naive(day)[0]
    )


def test_local_day_expression_emits_explicit_offset_not_localtime(zone_env):
    """The SQL must pin an offset; 'localtime' leaks the server OS zone."""
    zone_env("+08:00")
    expression = read_model._local_calendar_date_expr(
        read_model.time_record_attributed_at()
    )
    rendered = str(expression.compile(compile_kwargs={"literal_binds": True}))
    assert "localtime" not in rendered
    assert "+08:00" in rendered


def test_time_bounds_use_the_configured_zone(zone_env):
    zone_env("+08:00")
    start, end = time_bounds.date_range_bounds(date(2026, 10, 1), date(2026, 10, 7))
    assert start == datetime(2026, 9, 30, 16, 0)
    assert end == datetime(2026, 10, 7, 16, 0)


def test_reading_a_day_is_stable_regardless_of_process_zone(zone_env):
    """Two zones disagree on the calendar, but each is internally consistent."""
    zone_env("UTC")
    utc_start, utc_end = time_bounds.today_bounds()
    zone_env("+08:00")
    cst_start, cst_end = time_bounds.today_bounds()
    assert (utc_end - utc_start).total_seconds() == 86400
    assert (cst_end - cst_start).total_seconds() == 86400
    assert cst_start != utc_start


class TestStrictClientDatetime:
    """Offset-less client instants were the origin of the UTC/local confusion."""

    def test_accepts_zulu(self):
        assert parse_client_datetime("2026-10-06T20:58:15Z") == datetime(
            2026, 10, 6, 20, 58, 15
        )

    def test_normalises_explicit_offset_to_utc(self):
        assert parse_client_datetime("2026-10-07T04:58:15+08:00") == datetime(
            2026, 10, 6, 20, 58, 15
        )

    @pytest.mark.parametrize(
        "value",
        [
            "2026-10-06T20:58:15",
            "2026-10-06 20:58:15",
            "2026-10-06T20:58:15.123456",
        ],
    )
    def test_rejects_naive_instants(self, value):
        assert parse_client_datetime(value) is None

    @pytest.mark.parametrize("value", ["", "   ", "garbage", None])
    def test_rejects_unusable_input(self, value):
        assert parse_client_datetime(value) is None

    def test_rejects_naive_datetime_object(self):
        assert parse_client_datetime(datetime(2026, 10, 6, 20, 58)) is None

    def test_accepts_aware_datetime_object(self):
        aware = datetime(2026, 10, 7, 4, 58, tzinfo=timezone(timedelta(hours=8)))
        assert parse_client_datetime(aware) == datetime(2026, 10, 6, 20, 58)

    def test_treats_explicit_utc_offset_as_aware(self):
        assert parse_client_datetime("2026-10-06T20:58:15+00:00") == datetime(
            2026, 10, 6, 20, 58, 15
        )
