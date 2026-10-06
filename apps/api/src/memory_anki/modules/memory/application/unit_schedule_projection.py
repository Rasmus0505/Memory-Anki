"""Read-only schedule snapshots and change entries for review unit adjustments."""

from __future__ import annotations

from datetime import date
from typing import Any

from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

from .unit_scheduler import INTERVAL_DAYS, clamp_stage


def _schedule_snapshot(
    *,
    stage_index: int,
    due_date: date,
    has_passed: bool,
) -> dict[str, Any]:
    stage = clamp_stage(stage_index)
    return {
        "stage_index": stage,
        "interval_days": INTERVAL_DAYS[stage],
        "due_date": due_date.isoformat() if isinstance(due_date, date) else str(due_date),
        "has_passed": bool(has_passed),
    }


def _schedule_snapshot_from_row(row: ReviewUnitState) -> dict[str, Any]:
    return _schedule_snapshot(
        stage_index=row.stage_index,
        due_date=row.due_date,
        has_passed=row.has_passed,
    )


def _change_entry(
    *,
    unit_id: str,
    anchor_uid: str,
    title: str,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "unit_id": unit_id,
        "anchor_uid": anchor_uid,
        "title": title,
        "action": action,
        "before": before,
        "after": after,
    }


def _parse_due_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        raise ValueError("due_date is required")
    return date.fromisoformat(text[:10])


