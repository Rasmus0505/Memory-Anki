"""Read-only schedule snapshots and change entries for review unit adjustments."""

from __future__ import annotations

from datetime import date
from typing import Any

from memory_anki.core.time import study_day_of
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

from .unit_scheduler import INTERVAL_DAYS, clamp_stage


def unit_interval_days(row: ReviewUnitState) -> int:
    """The interval this unit was actually booked at, in whole study days.

    ``due_date`` is the product's booking, so the honest gap is
    ``due_date - 上次评分的学习日``. Deriving it from the FSRS card instead
    (``fsrs_due_at - fsrs_last_review``) disagrees with the visible due date
    whenever a product rule overrides FSRS: a failed grade books today, and a
    sprint clamp shortens the gap. A unit with no FSRS checkpoint yet (inherited
    or never rated) falls back to the legacy projection.
    """
    if row.fsrs_last_review is not None:
        reviewed_on = study_day_of(row.fsrs_last_review)
        return max(0, (row.due_date - reviewed_on).days)
    if row.stage_index > 0:
        return INTERVAL_DAYS[clamp_stage(row.stage_index)]
    return 0


def _schedule_snapshot(
    *,
    stage_index: int,
    due_date: date,
    has_passed: bool,
    interval_days: int | None = None,
) -> dict[str, Any]:
    stage = clamp_stage(stage_index)
    return {
        "stage_index": stage,
        "interval_days": (
            interval_days
            if interval_days is not None
            else INTERVAL_DAYS[stage]
        ),
        "due_date": due_date.isoformat() if isinstance(due_date, date) else str(due_date),
        "has_passed": bool(has_passed),
    }


def _schedule_snapshot_from_row(row: ReviewUnitState) -> dict[str, Any]:
    return _schedule_snapshot(
        stage_index=row.stage_index,
        due_date=row.due_date,
        has_passed=row.has_passed,
        interval_days=unit_interval_days(row),
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


