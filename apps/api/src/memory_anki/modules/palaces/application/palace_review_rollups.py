from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.reviews.api import get_palace_due_rollup


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


def _palace_due_rollup(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    try:
        return get_palace_due_rollup(session, palace.id, now=now)
    except ValueError:
        return None


def count_palace_review_units(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> dict[str, int]:
    current = now or datetime.now(UTC)
    projection = _palace_due_rollup(session, palace, now=current)
    if projection is None:
        return {
            "due_now_count": 0,
            "due_later_today_count": 0,
            "needs_practice_count": 0,
        }
    due_now_count = 1 if bool(projection.get("has_due_review") or projection.get("due_node_count")) else 0
    due_later_today_count = 0
    if due_now_count == 0 and _review_datetime_is_later_today(
        projection.get("next_review_at"), current
    ):
        due_later_today_count = 1
    return {
        "due_now_count": due_now_count,
        "due_later_today_count": due_later_today_count,
        "needs_practice_count": 0,
    }


def palace_has_due_review(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> bool:
    projection = _palace_due_rollup(session, palace, now=now)
    if projection is None:
        return False
    return bool(projection.get("has_due_review") or projection.get("due_node_count"))


def palace_has_due_later_today(
    session: Session,
    palace: Palace,
    *,
    now: datetime | None = None,
) -> bool:
    current = now or datetime.now(UTC)
    projection = _palace_due_rollup(session, palace, now=current)
    if projection is None:
        return False
    if projection.get("has_due_review") or projection.get("due_node_count"):
        return False
    return _review_datetime_is_later_today(projection.get("next_review_at"), current)


__all__ = [
    "_review_datetime_is_later_today",
    "count_palace_review_units",
    "palace_has_due_later_today",
    "palace_has_due_review",
]
