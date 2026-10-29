"""FSRS adapter for review units — the production scheduler.

This is the only module in ``modules/memory`` that may import ``fsrs``. It maps
the four product ratings onto FSRS while preserving the rules that are not
scheduling math: only ``忘记`` fails, a pass always lands at least one day out,
an ahead-of-date pass records the review without moving the schedule, the young
card's anchor phase is product-fixed, and the exam sprint horizon only shortens
a booked gap.

FSRS owns ``review_unit_states.due_date`` and the ``fsrs_*`` columns.
``stage_index`` survives only as a display/compat projection of the real
interval; nothing schedules from it.

Policy (``SCHEDULER_POLICY_VERSION`` ``anchor2-bands-1``):

- **Anchor phase** (``early_step == 0``, new cards only): the first pass gets one
  20-minute re-check (``unit_intraday``), then the overnight check on day 2.
  ``记得`` on the overnight check books +3 days and hands the card to FSRS;
  ``轻松`` books +5 days (or +3 straight from the first pass, skipping the
  re-check); ``困难`` only asks for one more overnight (+1 day); ``忘记`` retries
  the same day and re-runs the overnight check.
- **FSRS phase** (``early_step >= 1``): FSRS books, inside three guardrails —
  ``困难`` may never lengthen an interval (0.8x–1.0x the previous gap),
  ``记得``/``轻松`` are capped below 10 days (2.5x / 3.5x), and a lapse on a
  mature card recovers at a fraction of the pre-lapse interval once the
  overnight confirmation passes.
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

# A pass always lands at least one day out.
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
# that still read `stage_index`. Nothing sorts or books from these values.
LEGACY_STAGE_INTERVALS: tuple[int, ...] = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)

# --- Anchor phase -----------------------------------------------------------
# The first two checkpoints of a new card, product-fixed because a young card
# carries too little evidence for a stability estimate: (a) a same-day re-check
# after the first pass, (b) the overnight check on day 2. After the overnight
# check the card belongs to FSRS — there is no third fixed review.
ANCHOR_PHASE_STEP = 0
ANCHOR_GRADUATED_STEP = 1
# Closing the same-day re-check books tomorrow; that +1 IS the overnight check.
ANCHOR_STEP_DAYS = 1
# Overnight check outcomes: 记得 hands over with +3 days, 轻松 with +5 days.
ANCHOR_PASS_DAYS = 3
ANCHOR_EASY_DAYS = 5
# 困难 on the overnight check is a pass, but only buys one more overnight.
ANCHOR_HARD_DAYS = 1
# 轻松 on the very first pass skips the re-check and books +3 days.
ANCHOR_FIRST_EASY_DAYS = 3
# Kept for callers that used the retired four-step builder.
ANCHOR_STEPS = 2
# `stage_index` starts at 1 for a passed unit (a pass never books today).
MIN_PASSED_STAGE_INDEX = 1

# --- FSRS-phase guardrails --------------------------------------------------
# 困难 means "recalled, but effortfully". It must never push the card further
# out than the interval it already earned: 0.8x–1.0x the previous gap.
HARD_RATIO_MIN = 0.8
HARD_RATIO_MAX = 1.0
# Below ten days a young card may not leap too far in one step. This is a
# ceiling only — a shorter FSRS answer still wins.
GOOD_CAP_RATIO = 2.5
EASY_CAP_RATIO = 3.5
CAP_MAX_PREVIOUS_DAYS = 10
# A lapse on a mature card keeps a fraction of the interval it had earned once
# the overnight confirmation passes (Ebbinghaus' relearning savings).
LAPSE_MIN_PREVIOUS_DAYS = 14
LAPSE_RECOVERY_RATIO: dict[int, float] = {2: 0.25, 3: 0.30, 4: 0.35}

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
# changing a product rule (the anchor phase, a guardrail) re-runs the one-time
# replay instead of leaving units booked under the retired policy.
FSRS_ENGINE_VERSION = f"fsrs-{_FSRS_DISTRIBUTION_VERSION}"
SCHEDULER_POLICY_VERSION = "anchor2-bands-1"
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
    # True when the booked gap came from the anchor phase rather than FSRS'
    # interval. The audit fields above still carry FSRS' own answer.
    early_ladder_applied: bool = False
    anchor_applied: bool = False
    # True when a guardrail (困难 band, young-card cap, lapse recovery) replaced
    # FSRS' own answer.
    growth_cap_applied: bool = False
    guardrail_applied: bool = False
    # The anchor counter after this rating (0 = still anchored, 1 = FSRS owns).
    # ``unit_scheduler`` deliberately keeps the pre-rating value when the pass
    # only creates a same-day re-check, because that booking is not final yet.
    early_step: int | None = None
    # A mature lapse keeps the pre-lapse interval until the overnight
    # confirmation passes; both columns persist on the unit.
    lapse_original_days: int | None = None
    lapse_started_on: date | None = None


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
    """Best-effort *legacy* position for a unit rated before the counter existed.

    Returns the retired 0..3 four-step value. Callers on the current policy pass
    it through :func:`migrate_legacy_early_step` — a unit that already completed
    any day-level fixed review has passed its overnight check and graduates.
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
    return 3


def migrate_legacy_early_step(value: int | None) -> int | None:
    """Map the retired 0..3 anchor counter onto 0 (anchored) / 1 (graduated)."""
    if value is None:
        return None
    return ANCHOR_GRADUATED_STEP if int(value) >= 1 else ANCHOR_PHASE_STEP


def anchor_interval_days(
    *, rating: int, step_pending: bool, was_passed: bool
) -> int:
    """The fixed gap after one anchor-phase pass (rating >= 2).

    ``step_pending`` is the 20-minute re-check the learner is closing;
    ``was_passed`` is the unit's state before this rating, so ``False`` means
    this is the very first pass. The first pass books the day-level gap only
    after the re-check, and 轻松 skips both the re-check and the overnight check.
    """
    if step_pending or not was_passed:
        return ANCHOR_FIRST_EASY_DAYS if int(rating) >= 4 else ANCHOR_STEP_DAYS
    if int(rating) >= 4:
        return ANCHOR_EASY_DAYS
    if int(rating) >= 3:
        return ANCHOR_PASS_DAYS
    return ANCHOR_HARD_DAYS


def next_anchor_step(
    *, rating: int, early_step: int | None, step_pending: bool, was_passed: bool
) -> int | None:
    """The anchor counter after one rating.

    Graduation happens only on a pass that actually crosses the overnight
    boundary: 记得/轻松 on the overnight check, or 轻松 on the first pass (which
    skips the whole anchor phase). 困难 on the overnight check asks for one more
    day and stays anchored; 忘记 restarts the overnight check.
    """
    if early_step is None:
        # No counter recorded: the caller (the scheduler or the backfill) owns
        # the legacy inference, so do not invent a position here.
        return None
    step = int(early_step)
    if step >= ANCHOR_GRADUATED_STEP:
        return ANCHOR_GRADUATED_STEP
    if int(rating) <= 1:
        return ANCHOR_PHASE_STEP
    if step_pending or not was_passed:
        return ANCHOR_GRADUATED_STEP if int(rating) >= 4 else ANCHOR_PHASE_STEP
    return ANCHOR_GRADUATED_STEP if int(rating) >= 3 else ANCHOR_PHASE_STEP


def hard_band_days(*, previous_interval_days: int | None) -> tuple[int, int] | None:
    """The 困难 band as ``(min_days, max_days)`` for the previous booked gap.

    ``困难`` may shorten or keep the gap, never lengthen it. A retry day
    (previous gap 0) has no usable base and falls back to one day.
    """
    if previous_interval_days is None:
        return None
    previous = int(previous_interval_days)
    if previous <= 0:
        return (1, 1)
    low = max(1, round(previous * HARD_RATIO_MIN))
    high = max(low, previous)
    return (low, high)


def young_cap_days(*, rating: int, previous_interval_days: int | None) -> int | None:
    """Ceiling for a 记得/轻松 pass below ten days, or None when uncapped."""
    if previous_interval_days is None:
        return None
    previous = int(previous_interval_days)
    if previous <= 0 or previous >= CAP_MAX_PREVIOUS_DAYS:
        return None
    ratio = EASY_CAP_RATIO if int(rating) >= 4 else GOOD_CAP_RATIO
    return max(1, int(previous * ratio))


def lapse_recovery_days(*, rating: int, original_interval_days: int) -> int:
    """The restored gap after a mature lapse's overnight confirmation."""
    ratio = LAPSE_RECOVERY_RATIO.get(int(rating), LAPSE_RECOVERY_RATIO[3])
    return max(1, round(max(0, int(original_interval_days)) * ratio))


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
    # A horizon/fuzz clamp only moves the booked date; the band still names the
    # grade FSRS earned. A product override (anchor gap, guardrail) is the real
    # booking, so the band follows that instead.
    interval = (
        result.interval_days
        if result.anchor_applied or result.guardrail_applied
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
    hard_penalized_today: bool = False,
) -> bool:
    """Whether this rating is evidence FSRS should see.

    A pass on an ahead-of-date filler card is recorded by the product but does
    not move the schedule, so it must not advance the FSRS card either. Failed
    grades stay honest even when the card was early. ``hard_penalized_today`` is
    accepted for compatibility with the retired once-per-day 困难 rule and no
    longer changes anything: 困难 is a pass now.
    """
    _ = hard_penalized_today
    if rating >= 2 and schedule_locked:
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
    hard_penalized_today: bool = False,
    fuzz_key: str | None = None,
    horizon: SprintHorizon | None = None,
    scheduler: Scheduler | None = None,
    previous_interval_days: int | None = None,
    current_stage: int | None = None,
    early_step: int | None = None,
    step_pending: bool = False,
    lapse_original_days: int | None = None,
    lapse_started_on: date | None = None,
) -> FsrsScheduleResult:
    """Project one rating through FSRS plus the product rules.

    ``today`` is the study day. ``rated_at`` is the UTC instant of the rating;
    it becomes the FSRS review timestamp, while the returned due date is a local
    study day so the product can book and display it without timezone drift.
    ``early_step`` is the anchor counter (0 = anchored, 1 = FSRS owns).
    ``step_pending`` marks the 20-minute re-check being closed.
    ``lapse_*`` carry a mature card's pre-lapse interval until the overnight
    confirmation passes.
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

    passed = normalized >= 2
    schedule_changed = not (passed and schedule_locked)
    hard_penalty_applied = False
    horizon_applied = False
    fuzz_applied = False
    previous = max(0, int(previous_interval_days or 0))
    # ``None`` means "no counter recorded" — the scheduler infers a position
    # before calling. A direct caller with no counter gets the FSRS path, which
    # is the honest default for a card whose history we cannot place.
    anchored = early_step is not None and int(early_step) < ANCHOR_GRADUATED_STEP
    next_step = next_anchor_step(
        rating=normalized,
        early_step=early_step,
        step_pending=step_pending,
        was_passed=has_passed,
    )
    next_lapse_original = lapse_original_days
    next_lapse_started = lapse_started_on
    anchor_applied = False
    guardrail_applied = False

    if not passed:
        # 忘记 is the only failed grade: retry work today. A mature unit keeps a
        # memory of the interval it had earned, so the recovery after the
        # overnight confirmation is not a crawl back from one day.
        due = today
        interval = 0
        if not anchored and previous >= LAPSE_MIN_PREVIOUS_DAYS:
            if next_lapse_original is None:
                next_lapse_original = previous
                next_lapse_started = today
    elif schedule_locked:
        # A pass on an early card proves nothing about the booked interval.
        due = locked_due_date or today
        interval = max(0, (due - today).days)
    elif anchored:
        interval = anchor_interval_days(
            rating=normalized,
            step_pending=step_pending,
            was_passed=has_passed,
        )
        anchor_applied = True
        due = today + timedelta(days=interval)
    else:
        if (
            next_lapse_original is not None
            and next_lapse_started is not None
            and today > next_lapse_started
        ):
            # The overnight confirmation passed: restore a fraction of the gap
            # the card had before the lapse, then clear the state.
            interval = lapse_recovery_days(
                rating=normalized, original_interval_days=next_lapse_original
            )
            next_lapse_original = None
            next_lapse_started = None
            guardrail_applied = True
        else:
            interval = max(MIN_PASSED_INTERVAL_DAYS, raw_interval_days)
            if normalized == 2:
                band = hard_band_days(previous_interval_days=previous)
                if band is not None:
                    low, high = band
                    guarded = min(max(interval, low), high)
                    guardrail_applied = guarded != interval
                    interval = guarded
            else:
                cap = young_cap_days(
                    rating=normalized, previous_interval_days=previous
                )
                if cap is not None and interval > cap:
                    interval = cap
                    guardrail_applied = True
        if fuzz_key and interval >= FUZZ_MIN_INTERVAL_DAYS:
            offset = _fuzz_offset(interval, f"{fuzz_key}:fsrs")
            if offset:
                interval = max(1, interval + offset)
                fuzz_applied = True
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
        early_ladder_applied=anchor_applied,
        anchor_applied=anchor_applied,
        growth_cap_applied=guardrail_applied,
        guardrail_applied=guardrail_applied,
        early_step=next_step,
        lapse_original_days=next_lapse_original,
        lapse_started_on=next_lapse_started,
    )


def replay_history(
    operations: Sequence[HistoryOperation],
    *,
    unit_id: str,
    scheduler: Scheduler | None = None,
) -> ReplayResult:
    """Replay effective rating operations into the production FSRS state.

    Used by the one-time switch backfill and by undo when an old snapshot has no
    FSRS fields. Product rules (locked passes, retry grades, the anchor phase,
    the guardrails) are applied by :func:`rate_unit_with_fsrs` exactly as they
    are for a live rating, so the result is the same state the learner would
    have built up had FSRS been the scheduler all along.
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
    lapse_original: int | None = None
    lapse_started: date | None = None
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
                    migrate_legacy_early_step(int(str(recorded_step)))
                    if recorded_step not in (None, "")
                    else migrate_legacy_early_step(
                        infer_early_step(booked_gap_days=previous_interval_days)
                    )
                )
            else:
                previous_interval_days = 0
                early_step = ANCHOR_PHASE_STEP
            recorded_lapse = before.get("lapse_original_days")
            lapse_original = (
                int(str(recorded_lapse)) if recorded_lapse not in (None, "") else None
            )
            lapse_started = _parse_date(before.get("lapse_started_on"))
        # What the unit was booked at before this rating, taken from the
        # recorded due date rather than from this replay's own projection: the
        # anchor decision must match what the learner actually saw.
        if due_before is not None and previous_operation_day is not None:
            previous_interval_days = max(0, (due_before - previous_operation_day).days)
        schedule_locked = due_before is not None and due_before > operation_day
        if early_step is None and previous_operation_day is not None:
            early_step = migrate_legacy_early_step(
                infer_early_step(booked_gap_days=previous_interval_days)
            )
        try:
            result = rate_unit_with_fsrs(
                current=state,
                has_passed=bool(before.get("has_passed")),
                rating=int(operation.rating),
                today=operation_day,
                rated_at=_aware(operation.created_at),
                schedule_locked=schedule_locked,
                locked_due_date=due_before if schedule_locked else None,
                fuzz_key=unit_id,
                scheduler=active_scheduler,
                previous_interval_days=previous_interval_days,
                current_stage=stage_index,
                early_step=early_step,
                lapse_original_days=lapse_original,
                lapse_started_on=lapse_started,
            )
        except (TypeError, ValueError):
            skipped += 1
            continue
        state = result.state
        due_date = result.due_date
        has_passed = bool(before.get("has_passed")) or result.passed
        early_step = result.early_step
        lapse_original = result.lapse_original_days
        lapse_started = result.lapse_started_on
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
    "ANCHOR_EASY_DAYS",
    "ANCHOR_FIRST_EASY_DAYS",
    "ANCHOR_GRADUATED_STEP",
    "ANCHOR_HARD_DAYS",
    "ANCHOR_PASS_DAYS",
    "ANCHOR_PHASE_STEP",
    "ANCHOR_STEPS",
    "ANCHOR_STEP_DAYS",
    "CAP_MAX_PREVIOUS_DAYS",
    "DEFAULT_RETENTION",
    "EASY_CAP_RATIO",
    "FSRS_ENGINE_VERSION",
    "FSRS_RATINGS",
    "FsrsScheduleResult",
    "FsrsUnitState",
    "GOOD_CAP_RATIO",
    "HARD_RATIO_MAX",
    "HARD_RATIO_MIN",
    "HistoryOperation",
    "LAPSE_MIN_PREVIOUS_DAYS",
    "LAPSE_RECOVERY_RATIO",
    "LEGACY_STAGE_INTERVALS",
    "MAXIMUM_INTERVAL_DAYS",
    "MIN_PASSED_STAGE_INDEX",
    "ReplayResult",
    "SCHEDULER_POLICY_VERSION",
    "SCHEDULER_VERSION",
    "Scheduler",
    "anchor_interval_days",
    "build_shadow_scheduler",
    "build_unit_scheduler",
    "card_from_state",
    "hard_band_days",
    "infer_early_step",
    "lapse_recovery_days",
    "migrate_legacy_early_step",
    "next_anchor_step",
    "project_stage_index",
    "rate_unit_with_fsrs",
    "replay_history",
    "should_apply_fsrs",
    "stage_for_interval",
    "state_from_card",
    "state_payload",
    "young_cap_days",
]
