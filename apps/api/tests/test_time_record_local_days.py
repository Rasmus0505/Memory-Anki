"""Ledger fragments must split on the viewer's local midnight."""

from datetime import UTC, datetime, timedelta, timezone

from memory_anki.modules.session.application.time_record_read_model import (
    split_interval_local_days,
)


def test_split_interval_local_days_defaults_to_beijing(monkeypatch) -> None:
    monkeypatch.delenv("MEMORY_ANKI_LOCAL_TZ", raising=False)
    start = datetime(2026, 1, 1, 15, 30, tzinfo=UTC)
    end = datetime(2026, 1, 1, 16, 30, tzinfo=UTC)

    assert split_interval_local_days(start, end) == [
        ("2026-01-01", 1800),
        ("2026-01-02", 1800),
    ]


def test_split_interval_local_days_uses_requested_zone_not_utc() -> None:
    zone = timezone(timedelta(hours=8))
    start = datetime(2026, 1, 1, 15, 30, tzinfo=UTC)
    end = datetime(2026, 1, 1, 16, 30, tzinfo=UTC)

    assert split_interval_local_days(start, end, tz=zone) == [
        ("2026-01-01", 1800),
        ("2026-01-02", 1800),
    ]
