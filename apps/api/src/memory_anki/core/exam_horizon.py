"""Exam-horizon scheduling for the review ladder.

Framework-free so both the exam settings writer and the memory scheduler can
share one definition without a module dependency between them.

What the horizon does, and what it deliberately does not:

- It refuses to book a review after ``exam_date - 1``. A unit at the 60-day
  stage booked 60 days out is never seen again before a fixed exam, so the
  ladder silently stops serving the learner exactly when the material matters.
- When the natural interval would overshoot, the unit is pulled into the last
  week before the exam, spread deterministically per unit id. Without that
  spread every long interval lands on the same day and the learner faces the
  whole mature cohort on the eve of the exam.
- When there is no room left even for the pulled date, the unit keeps its
  normal interval and books after the exam. It was just reviewed; crushing it
  back onto today would only re-serve the same card every day at the end.
- It never lengthens an interval and never changes the ladder shape. The
  landing stage still names the grade, so the toolbar histogram and the
  ``${n}天级`` labels keep their meaning.

A ratio-of-horizon ceiling (``10-20%`` of the remaining days) is tempting and was
tried first: recomputed daily it collapses toward "review everything every day"
in the final weeks, and it roughly doubled the card count (39/day vs 20/day on
real data) while synchronising every unit onto the same cadence. The ladder
already carries the spacing decision; the horizon only bounds it.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

# Config row key owned by the exam module and read by the memory scheduler.
EXAM_SETTINGS_KEY = "exam_settings"

# Pulled reviews disperse across this many days before the exam, keyed by unit
# id, so a mature cohort does not all arrive on the last day.
END_SPREAD_DAYS = 7


def coerce_exam_date(value: Any) -> date | None:
    """Parse a stored ``YYYY-MM-DD`` value; anything else means "no exam date"."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _spread_offset(seed: str, span: int) -> int:
    if span <= 0:
        return 0
    digest = hashlib.blake2b(seed.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % (span + 1)


@dataclass(frozen=True)
class SprintHorizon:
    """The last usable review date before a fixed exam."""

    exam_date: date
    days_left: int

    @property
    def last_due(self) -> date:
        """Latest due date that still gets one review in before the exam."""
        return self.exam_date - timedelta(days=1)

    @property
    def max_interval_days(self) -> int:
        """Longest gap that still lands before the exam."""
        return max(1, (self.last_due - (self.exam_date - timedelta(days=self.days_left))).days)

    def schedule(
        self,
        nominal_interval_days: int,
        *,
        today: date,
        seed: str | None = None,
    ) -> date:
        """Next due date for a rating taken on ``today``.

        ``seed`` is the unit id: preview and commit pass the same one, so the
        button's promise and the booked date cannot diverge.
        """
        due = today + timedelta(days=max(1, int(nominal_interval_days)))
        if due <= self.last_due:
            return due
        offset = _spread_offset(seed, END_SPREAD_DAYS) if seed else 0
        pulled = self.last_due - timedelta(days=offset)
        if pulled <= today:
            # Nothing fits before the exam; the normal interval books after it.
            return due
        return pulled

    def payload(self) -> dict[str, Any]:
        return {
            "active": True,
            "exam_date": self.exam_date.isoformat(),
            "days_left": self.days_left,
            "max_interval_days": self.max_interval_days,
            "last_due": self.last_due.isoformat(),
        }


def resolve_sprint_horizon(
    *,
    exam_date: Any,
    sprint_mode: bool,
    today: date,
) -> SprintHorizon | None:
    """Sprint horizon, or ``None`` when the switch is off or the exam has arrived.

    Inert on exam day and after it: the horizon no longer constrains anything,
    and clamping every due date to "yesterday" would make the whole backlog
    overdue at once.
    """
    if not sprint_mode:
        return None
    parsed = coerce_exam_date(exam_date)
    if parsed is None:
        return None
    days_left = (parsed - today).days
    if days_left <= 0:
        return None
    return SprintHorizon(exam_date=parsed, days_left=days_left)


def read_exam_settings(raw: str | None) -> dict[str, Any]:
    """Parse the stored exam settings blob; unknown shapes read as empty."""
    try:
        loaded = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


__all__ = [
    "END_SPREAD_DAYS",
    "EXAM_SETTINGS_KEY",
    "SprintHorizon",
    "coerce_exam_date",
    "read_exam_settings",
    "resolve_sprint_horizon",
]
