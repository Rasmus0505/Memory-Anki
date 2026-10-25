"""FSRS adapter for review units — the production scheduler.

This is the only module in ``modules/memory`` that may import ``fsrs``. It maps
the four product ratings onto FSRS while preserving the rules that are not
scheduling math: a pass always lands at least one day out, an ahead-of-date pass
records the review without moving the schedule, a second ``困难`` on the same day
does not count twice, a failed grade retries today, and the exam sprint horizon
only shortens a booked gap.

FSRS owns ``review_unit_states.due_date`` and the ``fsrs_*`` columns.
``stage_index`` survives only as a display/compat projection of the real
interval; nothing schedules from it.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Protocol

from fsrs import Card, Rating, Scheduler, State

from memory_anki.core.exam_horizon import SprintHorizon
from memory_anki.core.time import ensure_utc_naive, study_day_of

# These mirror the product constants in unit_scheduler. They are duplicated here
# on purpose: the adapter is allowed to be imported without the ladder module,
# and a test can pin the two implementations to the same behaviour.
MIN_PASSED_INTERVAL_DAYS = 1
RETRY_AFTER_CARDS = 3
FUZZ_MIN_INTERVAL_DAYS = 7
FUZZ_RATIO = 0.05
DEFAULT_RETENTION = 0.9
MAXIMUM_INTERVAL_DAYS = 365
# The product schedules in whole study days and re-serves failed units on the
# same day through its own retry queue, so FSRS' minute-level learning steps
# would only make the card state disagree with the booked day. Empty steps make
# every pass land in Review with a whole-day interval.
LEARNING_STEPS: tuple[timedelta, ...] = ()
RELEARNING_STEPS: tuple[timedelta, ...] = ()

# Legacy ladder bounds, kept only as the compat projection for API consumers
# that still read `stage_index`. FSRS owns scheduling; nothing sorts or books
# from these values. The UI groups real intervals by its own day-range bands.
LEGACY_STAGE_INTERVALS: tuple[int, ...] = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)

# The first four reviews are product-fixed, not FSRS estimates. A young card
# carries too little evidence for a stability estimate, and one `困难` can
# multiply it several-fold (1.3 -> 3.3 days on the first review): the learner
# then sees a unit they called hard moved *further* out. The fixed rhythm is
# review #1 after 30 minutes (``unit_intraday.STEP_DELAY``, same day), then
# day 2 (+1), day 3 (+1) and day 5 (+2) from the learning day. The review after
# day 5 is the first one FSRS may book itself.
#
# ``EARLY_LADDER_INTERVALS`` holds the *booked gap* after each fixed day-level
# review. The gaps repeat (one day twice), so the position comes from the
# persisted ``early_step`` counter -- never from the previous gap alone.
EARLY_LADDER_INTERVALS: tuple[int, ...] = (1, 1, 2)
EARLY_LADDER_STEPS = len(EARLY_LADDER_INTERVALS)
EARLY_LADDER_MAX_DAYS = max(EARLY_LADDER_INTERVALS)
# ``early_step`` counts completed day-level fixed reviews. At this value the
# fixed phase is over and FSRS owns the interval.
EARLY_LADDER_MAX_STEP = EARLY_LADDER_STEPS
# Kept for callers that used the old stage bound; it now means the same thing
# as :data:`EARLY_LADDER_MAX_STEP`.
EARLY_LADDER_MAX_STAGE = EARLY_LADDER_MAX_STEP
# `stage_index` starts at 1 for a passed unit (a pass never books today).
MIN_PASSED_STAGE_INDEX = 1

# Even after the fixed early ladder, a young unit's interval may not grow faster
# than this per review: FSRS already wants 20 days right after the 3-day review,
# and one overestimate compounds into months. Doubling is the classic Anki ease
# shape and keeps the early rhythm legible; a shorter FSRS answer still wins
# (this is a ceiling, not a target). Above 30 days FSRS decides alone. A retry
# day (previous gap 0) is not capped: its base is the same-day failure, not the
# interval the unit had earned.
GROWTH_CAP_MAX_PREVIOUS_DAYS = 30
GROWTH_CAP_RATIO = 2
GROWTH_CAP_MIN_DAYS = 3

FSRS_RATINGS: dict[int, Rating] = {
    1: Rating.Again,
    2: Rating.Hard,
    3: Rating.Good,
    4: Rating.Easy,
}

try:
    _FSRS_DISTRIBUTION_VERSION = version("fsrs")
except PackageNotFoundError:  # packaged builds may omit distribution metadata
    _FSRS_DISTRIBUTION_VERSION = "unknown"

# The stored version names the whole scheduling policy, not just the library, so
# changing a product rule (the fixed early ladder) re-runs the one-time replay
# instead of leaving units booked under the retired policy.
FSRS_ENGINE_VERSION = f"fsrs-{_FSRS_DISTRIBUTION_VERSION}"
SCHEDULER_POLICY_VERSION = "early-ladder-3"
SCHEDULER_VERSION = f"{FSRS_ENGINE_VERSION}+{SCHEDULER_POLICY_VERSION}"


@dataclass(frozen=True)
class FsrsUnitState:
    """The FSRS card fields persisted for one review unit."""

    stability: float | None = None
    difficulty: float | None = None
    fsrs_state: int = int(State.Learning)
    step: int | None = 0
    due_at: datetime | None = None
    last_review: datetime | None = None

    @classmethod
    def empty(cls) -> FsrsUnitState:
        return cls()

    def is_empty(self) -> bool:
        """True when no review has ever been recorded on this card.

        A row whose ``fsrs_*`` columns are all NULL is not the same thing as a
        brand-new card: it can be a unit created by inheritance, or one that
        predates the one-time backfill. :meth:`from_legacy` is the honest seed
        for those, so callers must check this instead of trusting a state object
        that merely exists.
        """
        return self.stability is None and self.last_review is None

    @classmethod
    def from_legacy(
        cls,
        *,
        stage_index: int,
        has_passed: bool,
        due_date: date,
    ) -> FsrsUnitState:
        """Seed a plausible FSRS card for a unit that has no stored state yet.

        This path is only a safety net for a rating that arrives before the
        one-time backfill (or for a direct caller that only has a ladder
        position). Without it, a mature unit would silently look like a brand
        new card and jump to a one-day interval.
        """
        stage = max(0, min(int(stage_index), len(LEGACY_STAGE_INTERVALS) - 1))
        if not has_passed and stage == 0:
            return cls.empty()
        interval = max(1, LEGACY_STAGE_INTERVALS[stage])
        due_at = datetime.combine(due_date, time(4))
        return cls(
            stability=float(interval),
            difficulty=5.0,
            fsrs_state=int(State.Review),
            step=None,
            due_at=due_at,
            last_review=due_at - timedelta(days=interval),
        )


@dataclass(frozen=True)
class FsrsScheduleResult:
    state: FsrsUnitState
    due_date: date
    passed: bool
    retry_after_cards: int
    schedule_changed: bool
    hard_penalty_applied: bool
    fsrs_applied: bool
    schedule_locked: bool
    horizon_applied: bool
    fuzz_applied: bool
    raw_due_date: date | None
    raw_interval_days: int
    interval_days: int
    # True when the booked gap came from the fixed early ladder rather than
    # FSRS' interval. The audit fields above still carry FSRS' own answer.
    early_ladder_applied: bool = False
    # True when FSRS wanted more days than the young-unit growth ceiling.
    growth_cap_applied: bool = False
    # The fixed-ladder counter after this rating (None when FSRS owns the unit).
    # ``unit_scheduler`` deliberately keeps the pre-rating value when the pass
    # only creates a same-day re-check, because that booking is not final yet.
    early_step: int | None = None


@dataclass(frozen=True)
class ReplayResult:
    """The end state of replaying a unit's effective rating history."""

    state: FsrsUnitState
    due_date: date | None
    has_passed: bool
    stage_index: int
    operations: int
    skipped: int
    early_step: int | None = None


class HistoryOperation(Protocol):
    """The columns the adapter needs from review_unit_rating_operations."""

    created_at: datetime
    rating: int
    before_state_json: str


def stage_for_interval(interval_days: int) -> int:
    """Nearest lower legacy stage for a real FSRS interval (display only)."""
    days = max(0, int(interval_days))
    selected = 0
    for index, interval in enumerate(LEGACY_STAGE_INTERVALS):
        if interval > days:
            break
        selected = index
    return selected


def infer_early_step(*, booked_gap_days: int | None) -> int | None:
    """Best-effort position for a unit rated before the counter was stored.

    The migration runs at startup, so this is a safety net for a row that
    slipped through (or a unit rated under the previous 1/2/3-day policy).
    Under that policy a booked gap of 1 meant "the 30-minute re-check passed",
    2 meant two day-level reviews, and 3 meant three; anything at 4+ was
    already FSRS' own booking. ``None`` means the caller has no booking to read
    and the unit should be treated as a pure FSRS card.
    """
    if booked_gap_days is None:
        return None
    gap = max(0, int(booked_gap_days))
    if gap <= 1:
        return 0
    if gap == 2:
        return 1
    if gap == 3:
        return 2
    return EARLY_LADDER_MAX_STEP


def early_ladder_interval(*, rating: int, early_step: int | None) -> int | None:
    """The fixed early interval for this pass, or None when FSRS decides.

    ``early_step`` is the number of fixed day-level reviews already completed
    (0..``EARLY_LADDER_STEPS``). It is persisted on the unit precisely because
    the ladder gaps repeat: the previous booked gap cannot tell the second
    one-day step from the first. ``None`` means the caller cannot tell, and the
    safe answer is "let FSRS book".
    """
    if early_step is None:
        return None
    step = max(0, int(early_step))
    if step >= EARLY_LADDER_STEPS:
        return None
    if int(rating) >= 4:
        # 轻松 takes the last fixed step, never skips past it.
        return EARLY_LADDER_INTERVALS[-1]
    return EARLY_LADDER_INTERVALS[step]


def next_early_step(*, rating: int, early_step: int | None) -> int | None:
    """The counter after this rating.

    A pass advances one fixed review (轻松 jumps to the end); 困难 demotes one
    step and 忘记 restarts the fixed sequence -- but only while the unit is
    still inside it. A unit that already handed over to FSRS keeps the finished
    marker, so a mature lapse stays on the FSRS path instead of restarting the
    fixed ladder.
    """
    if early_step is None:
        return None
    step = max(0, int(early_step))
    if step >= EARLY_LADDER_STEPS:
        return EARLY_LADDER_MAX_STEP
    if int(rating) >= 4:
        return EARLY_LADDER_MAX_STEP
    if int(rating) >= 3:
        return min(EARLY_LADDER_STEPS, step + 1)
    if int(rating) == 2:
        return max(0, step - 1)
    return 0


def growth_cap_days(*, previous_interval_days: int | None) -> int | None:
    """Ceiling for the next booking after the fixed early ladder, or None.

    ``previous_interval_days`` is the gap the unit was actually booked at. A
    retry day (zero gap) has no usable base and is left to FSRS; from 30 days up
    the unit is mature and FSRS decides alone.
    """
    if previous_interval_days is None:
        return None
    previous = int(previous_interval_days)
    if previous <= 0 or previous >= GROWTH_CAP_MAX_PREVIOUS_DAYS:
        return None
    return max(GROWTH_CAP_MIN_DAYS, previous * GROWTH_CAP_RATIO)


def reschedule_early_unit(
    *,
    rating: int,
    operation_day: date,
    due_before: date | None,
    early_step_before: int | None,
) -> tuple[date, int] | None:
    """What the current policy would book for a unit's *last* effective rating.

    Kept for callers that re-derive a young unit's booking without replaying the
    whole ledger. Returns ``(due_date, stage_index)`` or None when the last
    rating did not move the schedule (a failed grade retries today; an
    ahead-of-date pass is locked; a mature last rating belongs to FSRS).
    """
    if int(rating) < 3:
        return None
    if due_before is not None and due_before > operation_day:
        return None
    interval = early_ladder_interval(
        rating=int(rating),
        early_step=early_step_before,
    )
    if interval is None:
        return None
    return operation_day + timedelta(days=interval), stage_for_interval(interval)


def project_stage_index(
    *,
    current_stage: int,
    rating: int,
    result: FsrsScheduleResult,
) -> int:
    """The stored display projection after one rating (shared by live and replay)."""
    stage = max(0, min(int(current_stage), len(LEGACY_STAGE_INTERVALS) - 1))
    if not result.schedule_changed:
        return stage
    if int(rating) == 1:
        return 0
    if int(rating) == 2:
        return max(0, stage - (1 if result.hard_penalty_applied else 0))
    # A product override (fixed ladder or growth ceiling) is the real booking,
    # so the display band must follow it; a sprint-shortened gap still shows
    # FSRS' own interval.
    interval = (
        result.interval_days
        if result.early_ladder_applied or result.growth_cap_applied
        else result.raw_interval_days
    )
    return max(MIN_PASSED_STAGE_INDEX, stage_for_interval(interval))


def build_unit_scheduler(
    *,
    retention: float = DEFAULT_RETENTION,
    maximum_interval: int = MAXIMUM_INTERVAL_DAYS,
) -> Scheduler:
    """The production unit scheduler: deterministic FSRS.

    FSRS' own fuzzing uses the process-wide ``random`` module, which would make
    a preview and the committed due date disagree. The adapter applies its own
    stable per-unit spread after the interval is computed instead.
    """
    return Scheduler(
        desired_retention=retention,
        maximum_interval=maximum_interval,
        learning_steps=LEARNING_STEPS,
        relearning_steps=RELEARNING_STEPS,
        enable_fuzzing=False,
    )


# The old shadow report imports this name; it is the same production scheduler.
build_shadow_scheduler = build_unit_scheduler


def should_apply_fsrs(
    rating: int,
    *,
    schedule_locked: bool,
    hard_penalized_today: bool,
) -> bool:
    """Whether this rating is evidence FSRS should see.

    A pass on an ahead-of-date filler card is recorded by the product but does
    not move the schedule, so it must not advance the FSRS card either. A second
    ``困难`` on the same day is retry work without a second demotion. Failed
    grades stay honest even when the card was early.
    """
    if rating >= 3 and schedule_locked:
        return False
    if rating == 2 and hard_penalized_today:
        return False
    return True


def state_from_card(card: Card) -> FsrsUnitState:
    return FsrsUnitState(
        stability=card.stability,
        difficulty=card.difficulty,
        fsrs_state=int(card.state),
        step=card.step,
        due_at=ensure_utc_naive(card.due) if card.due else None,
        last_review=ensure_utc_naive(card.last_review) if card.last_review else None,
    )


def card_from_state(state: FsrsUnitState) -> Card:
    return Card(
        card_id=0,
        state=State(int(state.fsrs_state)),
        step=state.step,
        stability=state.stability,
        difficulty=state.difficulty,
        due=_aware(state.due_at) if state.due_at else None,
        last_review=_aware(state.last_review) if state.last_review else None,
    )


def state_payload(state: FsrsUnitState) -> dict[str, Any]:
    """JSON-safe audit form stored in rating snapshots for undo/amend."""
    return {
        "stability": state.stability,
        "difficulty": state.difficulty,
        "state": state.fsrs_state,
        "step": state.step,
        "due_at": state.due_at.isoformat() if state.due_at else None,
        "last_review": state.last_review.isoformat() if state.last_review else None,
    }


def rate_unit_with_fsrs(
    *,
    current: FsrsUnitState,
    has_passed: bool,
    rating: int,
    today: date,
    rated_at: datetime,
    schedule_locked: bool,
    locked_due_date: date | None,
    hard_penalized_today: bool,
    fuzz_key: str | None = None,
    horizon: SprintHorizon | None = None,
    scheduler: Scheduler | None = None,
    previous_interval_days: int | None = None,
    current_stage: int | None = None,
    early_step: int | None = None,
) -> FsrsScheduleResult:
    """Project one rating through FSRS plus the product rules.

    ``today`` is the study day. ``rated_at`` is the UTC instant of the rating;
    it becomes the FSRS review timestamp, while the returned due date is a local
    study day so the product can book and display it without timezone drift.
    ``early_step`` is the unit's fixed-ladder counter; together with the rating
    it selects the fixed early interval. ``previous_interval_days`` /
    ``current_stage`` remain for callers that only know a booked position and
    for the growth ceiling.
    """
    normalized = int(rating)
    if normalized not in FSRS_RATINGS:
        raise ValueError("rating must be 1-4")
    use_fsrs = should_apply_fsrs(
        normalized,
        schedule_locked=schedule_locked,
        hard_penalized_today=hard_penalized_today,
    )
    state = current
    raw_due_date: date | None = None
    raw_interval_days = 0
    if use_fsrs:
        reviewed, _ = (scheduler or build_shadow_scheduler()).review_card(
            card_from_state(current),
            FSRS_RATINGS[normalized],
            review_datetime=_aware(rated_at),
        )
        state = state_from_card(reviewed)
        raw_due_date = study_day_of(reviewed.due)
        raw_interval_days = max(0, (raw_due_date - today).days)

    passed = normalized >= 3
    schedule_changed = not (passed and schedule_locked)
    hard_penalty_applied = normalized == 2 and has_passed and not hard_penalized_today
    horizon_applied = False
    fuzz_applied = False
    next_step = next_early_step(rating=normalized, early_step=early_step)
    early_interval = (
        early_ladder_interval(rating=normalized, early_step=early_step)
        if passed and not schedule_locked
        else None
    )
    growth_cap = (
        growth_cap_days(previous_interval_days=previous_interval_days)
        if passed and not schedule_locked and early_interval is None
        else None
    )
    early_ladder_applied = False
    growth_cap_applied = False

    if not passed:
        # 忘记 / 困难 are retry work. The FSRS state still records the evidence,
        # but the product contract keeps the unit due today.
        due = today
        interval = 0
    elif schedule_locked:
        # A pass on an early card proves nothing about the booked interval.
        due = locked_due_date or today
        interval = max(0, (due - today).days)
    else:
        if early_interval is not None:
            interval = early_interval
            early_ladder_applied = True
        else:
            interval = max(MIN_PASSED_INTERVAL_DAYS, raw_interval_days)
            if fuzz_key and interval >= FUZZ_MIN_INTERVAL_DAYS:
                offset = _fuzz_offset(interval, f"{fuzz_key}:fsrs")
                if offset:
                    interval = max(1, interval + offset)
                    fuzz_applied = True
            if growth_cap is not None and interval > growth_cap:
                interval = growth_cap
                growth_cap_applied = True
        due = today + timedelta(days=interval)
        if horizon is not None:
            bounded = horizon.schedule(interval, today=today, seed=fuzz_key)
            horizon_applied = bounded != due
            due = bounded
            interval = max(1, (due - today).days)

    return FsrsScheduleResult(
        state=state,
        due_date=due,
        passed=passed,
        retry_after_cards=0 if passed else RETRY_AFTER_CARDS,
        schedule_changed=schedule_changed,
        hard_penalty_applied=hard_penalty_applied,
        fsrs_applied=use_fsrs,
        schedule_locked=schedule_locked,
        horizon_applied=horizon_applied,
        fuzz_applied=fuzz_applied,
        raw_due_date=raw_due_date,
        raw_interval_days=raw_interval_days,
        interval_days=interval,
        early_ladder_applied=early_ladder_applied,
        growth_cap_applied=growth_cap_applied,
        early_step=next_step,
    )


def replay_history(
    operations: Sequence[HistoryOperation],
    *,
    unit_id: str,
    scheduler: Scheduler | None = None,
) -> ReplayResult:
    """Replay effective rating operations into the production FSRS state.

    Used by the one-time switch backfill and by undo when an old snapshot has no
    FSRS fields. Product rules (locked passes, same-day repeated 困难, retry
    grades) are applied by :func:`rate_unit_with_fsrs` exactly as they are for a
    live rating, so the result is the same state the learner would have built up
    had FSRS been the scheduler all along.
    """
    active_scheduler = scheduler or build_shadow_scheduler()
    state = FsrsUnitState.empty()
    due_date: date | None = None
    has_passed = False
    stage_index = 0
    skipped = 0
    seeded = False
    previous_interval_days: int | None = 0
    previous_operation_day: date | None = None
    early_step: int | None = None
    for operation in operations:
        before = _before_state(operation.before_state_json)
        operation_day = study_day_of(_aware(operation.created_at))
        due_before = _parse_date(before.get("due_date"))
        if not seeded:
            seeded = True
            # The first remaining operation is the start of this history window.
            # Normally that is a brand-new unit (stage 0) and the empty card is
            # exact. A window that starts mid-history -- a pruned ledger, or an
            # amendment that excludes earlier rows -- must resume from the
            # recorded legacy position instead of pretending the unit is new.
            legacy_stage = int(before.get("stage_index") or 0)
            legacy_passed = bool(before.get("has_passed"))
            if legacy_stage > 0 or legacy_passed:
                state = FsrsUnitState.from_legacy(
                    stage_index=legacy_stage,
                    has_passed=legacy_passed,
                    due_date=due_before or operation_day,
                )
                stage_index = min(legacy_stage, len(LEGACY_STAGE_INTERVALS) - 1)
                has_passed = legacy_passed
                due_date = due_before
                previous_interval_days = LEGACY_STAGE_INTERVALS[stage_index]
                recorded_step = before.get("early_step")
                early_step = (
                    int(str(recorded_step))
                    if recorded_step not in (None, "")
                    else infer_early_step(booked_gap_days=previous_interval_days)
                )
            else:
                previous_interval_days = 0
                early_step = 0
        # What the unit was booked at before this rating, taken from the
        # recorded due date rather than from this replay's own projection: the
        # early-ladder decision must match what the learner actually saw.
        if due_before is not None and previous_operation_day is not None:
            previous_interval_days = max(0, (due_before - previous_operation_day).days)
        schedule_locked = due_before is not None and due_before > operation_day
        hard_penalized_today = (
            str(before.get("hard_penalized_on") or "")[:10]
            == operation_day.isoformat()
        )
        if early_step is None and previous_operation_day is not None:
            early_step = infer_early_step(booked_gap_days=previous_interval_days)
        try:
            result = rate_unit_with_fsrs(
                current=state,
                has_passed=bool(before.get("has_passed")),
                rating=int(operation.rating),
                today=operation_day,
                rated_at=_aware(operation.created_at),
                schedule_locked=schedule_locked,
                locked_due_date=due_before if schedule_locked else None,
                hard_penalized_today=hard_penalized_today,
                fuzz_key=unit_id,
                scheduler=active_scheduler,
                previous_interval_days=previous_interval_days,
                current_stage=stage_index,
                early_step=early_step,
            )
        except (TypeError, ValueError):
            skipped += 1
            continue
        state = result.state
        due_date = result.due_date
        has_passed = bool(before.get("has_passed")) or result.passed
        early_step = result.early_step
        # The same projection the live rating persists, so a replay cannot put
        # a unit in a different display band than earning it live would.
        stage_index = project_stage_index(
            current_stage=stage_index,
            rating=int(operation.rating),
            result=result,
        )
        previous_operation_day = operation_day
    return ReplayResult(
        state=state,
        due_date=due_date,
        has_passed=has_passed,
        stage_index=stage_index,
        operations=len(operations),
        skipped=skipped,
        early_step=early_step,
    )


def _before_state(raw: str) -> dict[str, Any]:
    try:
        loaded = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    state = loaded.get("state") if isinstance(loaded, dict) else None
    return state if isinstance(state, dict) else {}


def _parse_date(value: Any) -> date | None:
    raw = str(value or "").strip()[:10]
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _fuzz_offset(interval: int, seed: str) -> int:
    span = max(1, round(interval * FUZZ_RATIO))
    digest = hashlib.blake2b(seed.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % (2 * span + 1) - span


__all__ = [
    "DEFAULT_RETENTION",
    "EARLY_LADDER_INTERVALS",
    "EARLY_LADDER_MAX_DAYS",
    "EARLY_LADDER_MAX_STAGE",
    "EARLY_LADDER_MAX_STEP",
    "EARLY_LADDER_STEPS",
    "FSRS_ENGINE_VERSION",
    "FSRS_RATINGS",
    "FsrsScheduleResult",
    "FsrsUnitState",
    "GROWTH_CAP_MAX_PREVIOUS_DAYS",
    "GROWTH_CAP_MIN_DAYS",
    "GROWTH_CAP_RATIO",
    "HistoryOperation",
    "LEGACY_STAGE_INTERVALS",
    "MAXIMUM_INTERVAL_DAYS",
    "MIN_PASSED_STAGE_INDEX",
    "ReplayResult",
    "SCHEDULER_POLICY_VERSION",
    "SCHEDULER_VERSION",
    "Scheduler",
    "build_shadow_scheduler",
    "build_unit_scheduler",
    "card_from_state",
    "early_ladder_interval",
    "growth_cap_days",
    "infer_early_step",
    "next_early_step",
    "project_stage_index",
    "rate_unit_with_fsrs",
    "replay_history",
    "reschedule_early_unit",
    "should_apply_fsrs",
    "stage_for_interval",
    "state_from_card",
    "state_payload",
]
