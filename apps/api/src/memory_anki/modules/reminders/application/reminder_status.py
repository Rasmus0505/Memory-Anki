"""设置页要展示的通道状态：下次计划、最近一次结果、连续失败。"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import resolve_local_timezone, study_day_of
from memory_anki.modules.reminders.application.reminder_schedule import next_reminder_at
from memory_anki.modules.reminders.application.reminder_settings import read_settings
from memory_anki.modules.reminders.infrastructure.delivery_store import (
    consecutive_failures,
    count_sent_on,
    latest_delivery,
)


def _as_utc_iso(value: datetime | None) -> str | None:
    """投递时间是 UTC-naive；不加偏移量的话浏览器会当成当地时间，差出一整个时区。"""
    if value is None:
        return None
    return value.replace(tzinfo=UTC).isoformat()


def build_status(session: Session, now: datetime | None = None) -> dict[str, Any]:
    settings = read_settings(session)
    now_local = now or datetime.now(resolve_local_timezone())
    planned = next_reminder_at(now_local, settings)
    today = study_day_of(now_local, resolve_local_timezone())
    last = latest_delivery(session)
    return {
        "enabled": settings.enabled,
        "bark_configured": settings.configured,
        "next_at": planned[0].isoformat() if planned else None,
        "next_slot": planned[1] if planned else None,
        "consecutive_failures": consecutive_failures(session),
        "sent_today": count_sent_on(session, today),
        "daily_cap": settings.daily_cap,
        "last_delivery": (
            {
                "status": last.status,
                "slot": last.slot,
                "study_day": last.study_day.isoformat(),
                "at": _as_utc_iso(last.updated_at),
                "title": last.title,
                "http_status": last.http_status,
                "error": last.error,
            }
            if last is not None
            else None
        ),
    }
