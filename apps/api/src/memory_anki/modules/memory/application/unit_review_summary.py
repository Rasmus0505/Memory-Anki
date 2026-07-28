"""Read summaries derived exclusively from permanent-mark review units."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_start_as_utc_naive, to_api_datetime
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitRatingOperation

from .unit_review_service import get_palace_unit_projection, list_due_units
from .unit_scheduler import INTERVAL_DAYS


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
            "units": [],
            "unit_count": 0,
            "due_unit_count": 0,
            "node_count": 0,
            "nodes": [],
            "total_node_count": 0,
            "scheduled_node_count": 0,
            "mastered_node_count": 0,
            "mastery_horizon_days": 365,
            "mastery_progress": 0.0,
            "mastery_percent": 0,
            "memory_health": 0.0,
            "memory_health_percent": 0,
            "due_node_count": 0,
            "overdue_node_count": 0,
            "has_due_review": False,
            "next_review_at": None,
            "next_review_date": None,
            "mastered": False,
            "severe_weak_node_count": 0,
            "review_entry_mode": "marking",
            "review_entry_label": "开始标记",
            "review_status": "marking_required",
            "due_branch_count": 0,
            "review_branch_summaries": [],
            "reinforcement_due_count": 0,
            "uninitialized_node_count": 0,
            "content_changed_node_count": 0,
        }
    units = list(projection["units"])
    node_count = sum(len(unit["node_uids"]) for unit in units)
    due_units = [unit for unit in units if unit["due"]]
    next_at = _due_datetime(projection.get("next_review_date"))
    normalized = (
        sum(int(unit["stage_index"]) for unit in units)
        / (len(units) * max(1, len(INTERVAL_DAYS) - 1))
        if units
        else 0.0
    )
    nodes = [
        {
            "node_uid": uid,
            "unit_id": unit["id"],
            "unit_revision": unit["revision"],
            "due": unit["due"],
            "due_at": _due_datetime(unit["due_date"]),
            "raw_due_at": _due_datetime(unit["due_date"]),
            "stage_index": unit["stage_index"],
        }
        for unit in units
        for uid in unit["node_uids"]
    ]
    return {
        **projection,
        "unit_count": len(units),
        "due_unit_count": len(due_units),
        "node_count": node_count,
        "nodes": nodes,
        "total_node_count": node_count,
        "scheduled_node_count": node_count if units else 0,
        "mastered_node_count": 0,
        "mastery_horizon_days": 365,
        "mastery_progress": normalized,
        "mastery_percent": round(normalized * 100),
        "memory_health": normalized,
        "memory_health_percent": round(normalized * 100),
        "due_node_count": sum(len(unit["node_uids"]) for unit in due_units),
        "overdue_node_count": sum(len(unit["node_uids"]) for unit in due_units),
        "has_due_review": bool(due_units),
        "next_review_at": next_at,
        "mastered": False,
        "severe_weak_node_count": 0,
        "review_entry_mode": "unit" if units else "marking",
        "review_entry_label": (
            "立即复习" if due_units else ("开始标记" if not units else "日期复习")
        ),
        "due_branch_count": len(due_units),
        "review_branch_summaries": units,
        "reinforcement_due_count": 0,
        "uninitialized_node_count": 0,
        "content_changed_node_count": 0,
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
