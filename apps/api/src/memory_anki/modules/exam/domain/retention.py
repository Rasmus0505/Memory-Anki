"""Read-only forgetting estimate layered on the fixed review ladder. Framework-free.

The ladder schedules each review so the learner should still recall ~90% at the
due date. We model recall as R(t) = 0.9 ** (t / S), where S is the ladder
interval of the unit's current stage and t is days since the last pass. This
never changes scheduling; it only powers curves, predictions and sorting.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

TARGET_RECALL = 0.9
MASTERED_RECALL = 0.8


@dataclass(frozen=True)
class UnitMemory:
    palace_id: int
    stage_interval_days: int
    has_passed: bool
    last_passed_at: datetime | date | None


def _as_date(value: datetime | date | None) -> date | None:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


def recall_probability(unit: UnitMemory, on: date) -> float:
    last = _as_date(unit.last_passed_at)
    if not unit.has_passed or last is None or unit.stage_interval_days <= 0:
        return 0.0
    elapsed = max(0, (on - last).days)
    return float(TARGET_RECALL ** (elapsed / unit.stage_interval_days))


def mean_recall(units: Iterable[UnitMemory], on: date) -> float:
    values = [recall_probability(unit, on) for unit in units]
    return sum(values) / len(values) if values else 0.0


def mastered_ratio(units: Sequence[UnitMemory], on: date) -> float:
    if not units:
        return 0.0
    mastered = sum(1 for unit in units if recall_probability(unit, on) >= MASTERED_RECALL)
    return mastered / len(units)


def retention_curve(units: Sequence[UnitMemory], start: date, days: int) -> list[dict[str, float | str]]:
    """Mean recall for each day if nothing is reviewed from ``start`` on."""
    return [
        {"date": (start + timedelta(days=offset)).isoformat(), "recall": round(mean_recall(units, start + timedelta(days=offset)), 4)}
        for offset in range(max(1, days))
    ]


def forgetting_degree(units: Sequence[UnitMemory], on: date) -> float:
    """0 = everything fresh, 1 = nothing recalled (or never learned)."""
    return 1.0 - mean_recall(units, on) if units else 1.0
