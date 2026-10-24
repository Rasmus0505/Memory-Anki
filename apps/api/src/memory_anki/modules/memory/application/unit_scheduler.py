"""Fixed, explainable scheduling policy for permanent-mark review units."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from memory_anki.core.exam_horizon import SprintHorizon
from memory_anki.core.time import local_day

from .unit_fsrs_adapter import (
    FsrsUnitState,
    Scheduler,
    build_unit_scheduler,
    rate_unit_with_fsrs,
    stage_for_interval,
)

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

# Same-day cohorts otherwise stay in lockstep forever: 50 units learned together
# come due together at every stage. Offsets are deterministic per
# (fuzz_key, stage) so a rating preview and the committed due date can never
# disagree. Callers that need exact intervals (tests, migrations) pass no key.
FUZZ_MIN_INTERVAL_DAYS = 7
FUZZ_RATIO = 0.05


@dataclass(frozen=True)
class UnitScheduleResult:
    # ``stage_index`` is a display projection of the real FSRS interval. It no
    # longer drives scheduling; callers should show the interval instead.
    stage_index: int
    due_date: date
    passed: bool
    retry_after_cards: int
    # True when this rating spent the unit's once-per-day 困难 demotion.
    hard_penalty_applied: bool = False
    # False when the rating was recorded but the schedule was deliberately left
    # alone (see ``schedule_locked``). The UI must say so out loud, because a
    # silently ignored rating is exactly the kind of invisible rule this
    # scheduler is meant to avoid.
    schedule_changed: bool = True
    # The FSRS card state after this rating. The service persists it on the unit;
    # a locked pass or repeated same-day 困难 returns the pre-rating state.
    fsrs_state: FsrsUnitState | None = None


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


def _fuzz_offset(interval: int, seed: str) -> int:
    """Stable offset in [-span, +span] derived from a seed string."""
    span = max(1, round(interval * FUZZ_RATIO))
    digest = hashlib.blake2b(seed.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % (2 * span + 1) - span


def latest_schedulable_due(today: date) -> date:
    """Latest due date a rating on ``today`` can produce.

    The ladder tops out at 365 days, plus the same fuzz span a top-stage pass
    may add. Anything later is not a schedule.
    """
    span = max(1, round(INTERVAL_DAYS[-1] * FUZZ_RATIO))
    return today + timedelta(days=INTERVAL_DAYS[-1] + span)


def clamp_schedulable_due(due: date, *, today: date) -> date:
    """Pull an absurd future due back to today. Past and in-window dates stay."""
    if due > latest_schedulable_due(today):
        return today
    return due


def assert_schedulable_due(due: date, *, today: date) -> date:
    """Reject a manually chosen date the ladder cannot produce."""
    if due > latest_schedulable_due(today):
        raise ValueError("到期日不能超过一年。复习间隔最长一年，更远的日期不会进入复习。")
    return due


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
    schedule_locked: bool = False,
    locked_due_date: date | None = None,
    hard_penalized_today: bool = False,
    horizon: SprintHorizon | None = None,
    fsrs_state: FsrsUnitState | None = None,
    scheduler: Scheduler | None = None,
) -> UnitScheduleResult:
    """Rate one unit through the production FSRS scheduler.

    ``had_failure_in_encounter`` is kept in the signature because every caller
    passes it and it remains useful product context; FSRS learns the same fact
    from the actual ``忘记``/``困难`` ratings already replayed into its state.
    ``stage_index`` is only the old display position, used to keep the
    compatibility projection sensible for failed grades.
    """
    current_day = today or local_day()
    normalized = normalize_rating(rating)
    current_state = (
        fsrs_state
        if fsrs_state is not None and not fsrs_state.is_empty()
        else FsrsUnitState.from_legacy(
            stage_index=stage_index,
            has_passed=has_passed,
            due_date=locked_due_date or current_day,
        )
    )
    result = rate_unit_with_fsrs(
        current=current_state,
        has_passed=has_passed,
        rating=normalized,
        today=current_day,
        # A fixed midday UTC instant keeps preview and commit on the same study
        # day even when the learner taps across the 03:00 rollover.
        rated_at=datetime.combine(current_day, time(4), tzinfo=UTC),
        schedule_locked=schedule_locked,
        locked_due_date=locked_due_date,
        hard_penalized_today=hard_penalized_today,
        fuzz_key=fuzz_key,
        horizon=horizon,
        scheduler=scheduler or build_unit_scheduler(),
    )
    if not result.schedule_changed:
        # A locked pass records the review but must not move the display
        # projection either; the FSRS state itself is intentionally unchanged.
        projected_stage = clamp_stage(stage_index)
    elif normalized == 1:
        projected_stage = 0
    elif normalized == 2:
        projected_stage = max(
            0,
            clamp_stage(stage_index) - (1 if result.hard_penalty_applied else 0),
        )
    else:
        # Use the raw FSRS interval, not the sprint-shortened product due, so
        # the display does not pretend the memory model changed near an exam.
        projected_stage = max(
            MIN_PASSED_STAGE, stage_for_interval(result.raw_interval_days)
        )
    return UnitScheduleResult(
        projected_stage,
        result.due_date,
        result.passed,
        result.retry_after_cards,
        hard_penalty_applied=result.hard_penalty_applied,
        schedule_changed=result.schedule_changed,
        fsrs_state=result.state,
    )


def stage_from_legacy_interval_days(value: float | int | None) -> int:
    if value is None:
        return 0
    return stage_for_interval(int(max(0.0, float(value))))


__all__ = [
    "FUZZ_MIN_INTERVAL_DAYS",
    "FUZZ_RATIO",
    "INTERVAL_DAYS",
    "MIN_PASSED_STAGE",
    "RATING_LABELS",
    "RETRY_AFTER_CARDS",
    "VALID_RATINGS",
    "UnitScheduleResult",
    "assert_schedulable_due",
    "clamp_schedulable_due",
    "interval_days",
    "latest_schedulable_due",
    "normalize_rating",
    "rate_unit",
    "scheduled_interval_days",
    "stage_from_legacy_interval_days",
]
