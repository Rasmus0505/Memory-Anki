from __future__ import annotations

from datetime import UTC, datetime


def utc_now() -> datetime:
    return datetime.now(UTC)


def utc_now_naive() -> datetime:
    return utc_now().replace(tzinfo=None)


def iso_utc_now() -> str:
    return utc_now().isoformat()


def iso_utc_now_naive() -> str:
    return utc_now_naive().isoformat()
