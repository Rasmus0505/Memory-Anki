from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.memory.api import read_palace_due_signals


def _review_datetime_is_later_today(dt: Any, now: datetime) -> bool:
    if not dt:
        return False
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except ValueError:
            return False
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
        now = now.replace(tzinfo=None) if now.tzinfo else now
    if dt <= now:
        return False
    return dt.date() == now.date()


def _due_flags_from_signal(signal: dict[str, Any], now: datetime) -> dict[str, int]:
    due_now_count = 1 if bool(signal.get("has_due_review")) else 0
    due_later_today_count = 0
    if due_now_count == 0 and _review_datetime_is_later_today(signal.get("next_review_at"), now):
        due_later_today_count = 1
    return {
        "due_now_count": due_now_count,
        "due_later_today_count": due_later_today_count,
    }


def catalog_palace_due_counts(
    session: Session,
    palaces: list[Palace],
    *,
    now: datetime | None = None,
) -> dict[int, dict[str, int]]:
    """One read-only query for the subject shelf. Never reconciles review units."""
    current = now or datetime.now(UTC)
    signals = read_palace_due_signals(session, [palace.id for palace in palaces])
    return {
        palace.id: _due_flags_from_signal(signals.get(palace.id, {}), current)
        for palace in palaces
    }


def count_palace_review_units(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    return catalog_palace_due_counts(session, [palace], now=now)[palace.id]


def palace_has_due_review(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> bool:
    del now
    signal = read_palace_due_signals(session, [palace.id]).get(palace.id, {})
    return bool(signal.get("has_due_review"))


def palace_has_due_later_today(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> bool:
    current = now or datetime.now(UTC)
    return _due_flags_from_signal(
        read_palace_due_signals(session, [palace.id]).get(palace.id, {}),
        current,
    )["due_later_today_count"] > 0


__all__ = [
    "_review_datetime_is_later_today",
    "catalog_palace_due_counts",
    "count_palace_review_units",
    "palace_has_due_later_today",
    "palace_has_due_review",
]
