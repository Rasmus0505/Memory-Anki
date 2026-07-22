"""Pure policy helpers for palace wave adsorption and safety windows.

No SQLAlchemy / FastAPI imports — unit-testable domain rules.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any


WAVE_TYPE_FORMAL = "formal_long_term"
WAVE_TYPE_REINFORCEMENT = "same_day_reinforcement"

WAVE_STATUS_SCHEDULED = "scheduled"
WAVE_STATUS_ACTIVE = "active"
WAVE_STATUS_PAUSED = "paused"
WAVE_STATUS_COMPLETED = "completed"
WAVE_STATUS_CANCELLED = "cancelled"

ITEM_PENDING = "pending"
ITEM_RATED_DIRECT = "rated_direct"
ITEM_RATED_INHERITED = "rated_inherited"
ITEM_PENDING_REINFORCEMENT = "pending_reinforcement"
ITEM_DONE = "done"
ITEM_CONTENT_CHANGED = "content_changed"

SCHEDULE_UNINITIALIZED = "uninitialized"
SCHEDULE_CONTENT_CHANGED = "content_changed"
SCHEDULE_MANUAL = "manual"
SCHEDULE_PRACTICE = "practice"
SCHEDULE_WAVE_ADSORB = "wave_adsorb"
SCHEDULE_CALIBRATED = "calibrated"
SCHEDULE_REINFORCEMENT = "reinforcement"

# Safety window: pull earlier ≤ 20% of interval and ≤ 3 days;
# push later ≤ 10% of interval and ≤ 1 day; retention drop ≤ 3pp.
MAX_PULL_EARLIER_RATIO = 0.20
MAX_PULL_EARLIER_DAYS = 3
MAX_PUSH_LATER_RATIO = 0.10
MAX_PUSH_LATER_DAYS = 1
MAX_RETENTION_DROP = 0.03

DEFAULT_AGAIN_REINFORCEMENT_MINUTES = 20
DEFAULT_HARD_REINFORCEMENT_MINUTES = 60

BASELINE_TIERS: dict[str, dict[str, Any]] = {
    "new": {"stability": None, "difficulty": None, "initialized": False},
    "weak": {"stability": 1.0, "difficulty": 7.0, "initialized": True},
    "fair": {"stability": 7.0, "difficulty": 5.0, "initialized": True},
    "strong": {"stability": 30.0, "difficulty": 3.0, "initialized": True},
}


@dataclass(frozen=True)
class WaveCandidate:
    wave_id: str
    local_date: date
    status: str


def interval_days(last_review_at: datetime | None, raw_due_at: datetime) -> float:
    """Positive interval length in days (minimum small epsilon)."""
    if last_review_at is None:
        return 1.0
    seconds = (raw_due_at - last_review_at).total_seconds()
    return max(seconds / 86400.0, 1.0 / 1440.0)  # at least one minute


def fsrs_retrievability(
    stability_days: float | None,
    *,
    elapsed_days: float,
) -> float:
    """Approximate FSRS-4.5/6 retrievability R = (1 + t/(9S))^-1 for policy checks."""
    if stability_days is None or stability_days <= 0:
        return 0.0
    return (1.0 + elapsed_days / (9.0 * stability_days)) ** -1


def safety_window_bounds(
    *,
    anchor: date,
    interval_days_value: float,
) -> tuple[date, date]:
    """Return [earliest, latest] local dates within the adaptive safety window."""
    pull_days = min(MAX_PULL_EARLIER_DAYS, interval_days_value * MAX_PULL_EARLIER_RATIO)
    push_days = min(MAX_PUSH_LATER_DAYS, interval_days_value * MAX_PUSH_LATER_RATIO)
    earliest = anchor - timedelta(days=math.floor(pull_days))
    latest = anchor + timedelta(days=math.floor(push_days))
    return earliest, latest


def local_date_of(value: datetime, *, tz_offset_minutes: int | None = None) -> date:
    """Convert a UTC-naive (or aware) datetime to a local calendar date.

    When ``tz_offset_minutes`` is None, use the host local timezone (device-local day).
    """
    if value.tzinfo is not None:
        local = value.astimezone()
        return local.date()
    if tz_offset_minutes is None:
        # Interpret naive as UTC storage, convert to local wall date.
        from datetime import UTC

        aware = value.replace(tzinfo=UTC)
        return aware.astimezone().date()
    from datetime import timezone

    aware = value.replace(tzinfo=timezone.utc)
    offset = timezone(timedelta(minutes=tz_offset_minutes))
    return aware.astimezone(offset).date()


def effective_due_at_for_local_date(local_day: date) -> datetime:
    """Map a formal wave local day to a UTC-naive due timestamp (local midnight → UTC)."""
    from memory_anki.core.time import local_calendar_day_start_as_utc_naive

    return local_calendar_day_start_as_utc_naive(local_day)


def retention_ok_for_later(
    *,
    stability_days: float | None,
    desired_retention: float,
    raw_due_local: date,
    candidate_local: date,
    last_review_at: datetime | None,
) -> bool:
    """Later wave is allowed only if projected R stays within 3pp of target."""
    if candidate_local <= raw_due_local:
        return True
    if last_review_at is None or stability_days is None or stability_days <= 0:
        return candidate_local <= raw_due_local
    delay_days = (candidate_local - raw_due_local).days
    # elapsed from last review to candidate day (approx)
    base_elapsed = max((raw_due_local - local_date_of(last_review_at)).days, 0)
    r_at_candidate = fsrs_retrievability(
        stability_days, elapsed_days=float(base_elapsed + delay_days)
    )
    return r_at_candidate >= (desired_retention - MAX_RETENTION_DROP)


def pick_adsorb_wave(
    *,
    raw_due_local: date,
    interval_days_value: float,
    candidates: list[WaveCandidate],
    stability_days: float | None,
    desired_retention: float,
    last_review_at: datetime | None,
) -> WaveCandidate | None:
    """Choose the nearest existing formal wave inside the safety window.

    Prefer earlier wave when distances tie. Returns None when none fit.
    """
    earliest, latest = safety_window_bounds(
        anchor=raw_due_local, interval_days_value=interval_days_value
    )
    eligible: list[tuple[int, date, WaveCandidate]] = []
    for wave in candidates:
        if wave.status not in {
            WAVE_STATUS_SCHEDULED,
            WAVE_STATUS_ACTIVE,
            WAVE_STATUS_PAUSED,
        }:
            continue
        day = wave.local_date
        if day < earliest or day > latest:
            continue
        if not retention_ok_for_later(
            stability_days=stability_days,
            desired_retention=desired_retention,
            raw_due_local=raw_due_local,
            candidate_local=day,
            last_review_at=last_review_at,
        ):
            continue
        distance = abs((day - raw_due_local).days)
        eligible.append((distance, day, wave))
    if not eligible:
        return None
    eligible.sort(key=lambda item: (item[0], item[1], item[2].wave_id))
    return eligible[0][2]


def reinforcement_delay_minutes(rating: int, *, again_minutes: int, hard_minutes: int) -> int | None:
    if rating == 1:
        return max(1, again_minutes)
    if rating == 2:
        return max(1, hard_minutes)
    return None


def is_formal_queue_eligible(schedule_source: str | None, *, has_memory: bool) -> bool:
    """Nodes that may appear in formal long-term due queues."""
    if not has_memory:
        return False
    source = schedule_source or SCHEDULE_UNINITIALIZED
    return source not in {
        SCHEDULE_UNINITIALIZED,
        SCHEDULE_CONTENT_CHANGED,
        SCHEDULE_REINFORCEMENT,
    }
