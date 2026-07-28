"""Read summaries derived exclusively from permanent-mark review units."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_start_as_utc_naive, to_api_datetime
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitRatingOperation

from .unit_review_service import get_palace_unit_projection, list_due_units


def _due_datetime(raw: str | None) -> str | None:
    if not raw:
        return None
    return to_api_datetime(local_calendar_day_start_as_utc_naive(date.fromisoformat(raw)))


def get_palace_review_summary(
    session: Session,
    palace_id: int,
    **_: Any,
) -> dict[str, Any]:
    try:
        projection = get_palace_unit_projection(session, palace_id)
    except ValueError:
        return {
            "palace_id": palace_id,
            "units": [],
            "mark_required": True,
            "permanent_mark_count": 0,
            "unit_count": 0,
            "due_unit_count": 0,
            "has_due_review": False,
            "next_review_at": None,
            "next_review_date": None,
            "review_status": "marking_required",
        }
    units = list(projection["units"])
    due_units = [unit for unit in units if unit["due"]]
    next_at = _due_datetime(projection.get("next_review_date"))
    return {
        **projection,
        "unit_count": len(units),
        "due_unit_count": len(due_units),
        "has_due_review": bool(due_units),
        "next_review_at": next_at,
    }


def project_palace_review_summaries(
    session: Session,
    palaces: Iterable[Any],
    **_: Any,
) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
    for palace in palaces:
        palace_id = int(getattr(palace, "id", palace))
        result[palace_id] = get_palace_review_summary(session, palace_id)
    return result


def get_review_queue_summary(session: Session, **_: Any) -> dict[str, Any]:
    items = list_due_units(session)
    return {
        "items": items,
        "count": len(items),
        "due_count": len(items),
        "reviews": items,
    }


def get_unit_review_weekly_stats(session: Session) -> dict[str, Any]:
    since = datetime.now() - timedelta(days=7)
    operations = (
        session.query(ReviewUnitRatingOperation)
        .filter(
            ReviewUnitRatingOperation.created_at >= since,
            ReviewUnitRatingOperation.undone_at.is_(None),
            ReviewUnitRatingOperation.replaced_at.is_(None),
        )
        .all()
    )
    return {
        "review_count": sum(1 for item in operations if item.passed),
        "rating_count": len(operations),
        "review_duration_seconds": 0,
    }


__all__ = [
    "get_palace_review_summary",
    "get_review_queue_summary",
    "get_unit_review_weekly_stats",
    "project_palace_review_summaries",
]
