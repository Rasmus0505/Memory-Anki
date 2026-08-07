"""Fixed, explainable scheduling policy for permanent-mark review units."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, timedelta

# Stage 0 is the initial-learning state. A successful first "remember" moves
# to stage 1, whose one-day interval guarantees a review on the next day.
INTERVAL_DAYS: tuple[int, ...] = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)
RATING_LABELS: dict[int, str] = {1: "忘记", 2: "困难", 3: "记得", 4: "轻松"}
VALID_RATINGS = frozenset(RATING_LABELS)
RETRY_AFTER_CARDS = 3

# A pass must always land at least one day out. Stage 0 is the same-day learning
# slot, so crediting a pass there would leave the unit due today and re-served by
# the very next queue build -- the unit looked "done" yet never left the queue.
MIN_PASSED_STAGE = 1

# A lapse keeps part of the ladder position it had earned rather than resetting
# to first-learning. Forgetting a 365-day unit should cost months, not the whole
# ~475-day climb back up.
LAPSE_RETENTION = 0.5

# Same-day cohorts otherwise stay in lockstep forever: 50 units learned together
# come due together at every stage. Offsets are deterministic per
# (fuzz_key, stage) so a rating preview and the committed due date can never
# disagree. Callers that need exact intervals (tests, migrations) pass no key.
FUZZ_MIN_INTERVAL_DAYS = 7
FUZZ_RATIO = 0.05


@dataclass(frozen=True)
class UnitScheduleResult:
    stage_index: int
    due_date: date
    passed: bool
    retry_after_cards: int


def normalize_rating(value: int | str) -> int:
    if isinstance(value, str):
        labels = {label: rating for rating, label in RATING_LABELS.items()}
        if value in labels:
            return labels[value]
    rating = int(value)
    if rating not in VALID_RATINGS:
        raise ValueError("rating must be 1-4 or 忘记/困难/记得/轻松")
    return rating


def clamp_stage(stage_index: int) -> int:
    return max(0, min(int(stage_index), len(INTERVAL_DAYS) - 1))


def interval_days(stage_index: int) -> int:
    """Nominal ladder interval for a stage, ignoring any per-unit spread."""
    return INTERVAL_DAYS[clamp_stage(stage_index)]


def lapse_stage(stage_index: int, has_passed: bool) -> int:
    """Landing stage after 忘记.

    Units that never passed return to first-learning. Units that had earned a
    position keep a fraction of it, so the next interval stays proportional to
    demonstrated strength instead of collapsing to one day.
    """
    current = clamp_stage(stage_index)
    if not has_passed:
        return 0
    return clamp_stage(int(current * LAPSE_RETENTION))


def _fuzz_offset(interval: int, seed: str) -> int:
    """Stable offset in [-span, +span] derived from a seed string."""
    span = max(1, round(interval * FUZZ_RATIO))
    digest = hashlib.blake2b(seed.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % (2 * span + 1) - span


def scheduled_interval_days(stage_index: int, *, fuzz_key: str | None = None) -> int:
    """Ladder interval with deterministic per-unit spread applied.

    Short intervals are left exact: spreading a 1- or 3-day step would blur the
    early learning rhythm without easing any real load peak.
    """
    stage = clamp_stage(stage_index)
    nominal = INTERVAL_DAYS[stage]
    if fuzz_key is None or nominal < FUZZ_MIN_INTERVAL_DAYS:
        return nominal
    return max(1, nominal + _fuzz_offset(nominal, f"{fuzz_key}:{stage}"))


def rate_unit(
    *,
    stage_index: int,
    has_passed: bool,
    rating: int,
    had_failure_in_encounter: bool,
    today: date | None = None,
    fuzz_key: str | None = None,
) -> UnitScheduleResult:
    current_day = today or date.today()
    current_stage = clamp_stage(stage_index)
    normalized = normalize_rating(rating)

    # 忘记 is the only failing grade: relearn today, landing proportional to the
    # strength already earned.
    if normalized == 1:
        return UnitScheduleResult(
            lapse_stage(current_stage, has_passed),
            current_day,
            False,
            RETRY_AFTER_CARDS,
        )

    if not has_passed:
        # Still in first learning. 困难 keeps the unit in the same-day slot;
        # only an actual recall promotes it out.
        if normalized == 2:
            return UnitScheduleResult(0, current_day, False, RETRY_AFTER_CARDS)
        passed_stage = 1 if normalized == 3 else 2
    elif had_failure_in_encounter:
        # Relearning inside an encounter that already failed: a pass restores
        # position but never advances beyond it.
        if normalized == 2:
            passed_stage = current_stage - 1
        elif normalized == 3:
            passed_stage = current_stage
        else:
            passed_stage = current_stage + 1
    elif normalized == 2:
        # 困难 is a pass with a shortened interval, not a failure. It must be
        # able to hold a real interval, otherwise honest use only ratchets a
        # unit downwards and the grade becomes unusable.
        passed_stage = current_stage - 1
    elif normalized == 3:
        passed_stage = current_stage + 1
    else:
        passed_stage = current_stage + 2

    passed_stage = max(MIN_PASSED_STAGE, clamp_stage(passed_stage))
    interval = scheduled_interval_days(passed_stage, fuzz_key=fuzz_key)
    return UnitScheduleResult(
        passed_stage,
        current_day + timedelta(days=interval),
        True,
        0,
    )


def stage_from_legacy_interval_days(value: float | int | None) -> int:
    if value is None:
        return 0
    days = max(0.0, float(value))
    selected = 0
    for index, interval in enumerate(INTERVAL_DAYS):
        if interval > days:
            break
        selected = index
    return selected


__all__ = [
    "FUZZ_MIN_INTERVAL_DAYS",
    "FUZZ_RATIO",
    "INTERVAL_DAYS",
    "LAPSE_RETENTION",
    "MIN_PASSED_STAGE",
    "RATING_LABELS",
    "RETRY_AFTER_CARDS",
    "VALID_RATINGS",
    "UnitScheduleResult",
    "interval_days",
    "lapse_stage",
    "normalize_rating",
    "rate_unit",
    "scheduled_interval_days",
    "stage_from_legacy_interval_days",
]
