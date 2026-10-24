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

SCHEDULER_VERSION = f"fsrs-{_FSRS_DISTRIBUTION_VERSION}"


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


@dataclass(frozen=True)
class ReplayResult:
    """The end state of replaying a unit's effective rating history."""

    state: FsrsUnitState
    due_date: date | None
    has_passed: bool
    stage_index: int
    operations: int
    skipped: int


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
) -> FsrsScheduleResult:
    """Project one rating through FSRS plus the product rules.

    ``today`` is the study day. ``rated_at`` is the UTC instant of the rating;
    it becomes the FSRS review timestamp, while the returned due date is a local
    study day so the product can book and display it without timezone drift.
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
        interval = max(MIN_PASSED_INTERVAL_DAYS, raw_interval_days)
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
        schedule_locked = due_before is not None and due_before > operation_day
        hard_penalized_today = (
            str(before.get("hard_penalized_on") or "")[:10]
            == operation_day.isoformat()
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
                hard_penalized_today=hard_penalized_today,
                fuzz_key=unit_id,
                scheduler=active_scheduler,
            )
        except (TypeError, ValueError):
            skipped += 1
            continue
        state = result.state
        due_date = result.due_date
        has_passed = bool(before.get("has_passed")) or result.passed
        stage_index = stage_for_interval(result.interval_days)
    return ReplayResult(
        state=state,
        due_date=due_date,
        has_passed=has_passed,
        stage_index=stage_index,
        operations=len(operations),
        skipped=skipped,
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
    "FSRS_RATINGS",
    "FsrsScheduleResult",
    "FsrsUnitState",
    "HistoryOperation",
    "LEGACY_STAGE_INTERVALS",
    "MAXIMUM_INTERVAL_DAYS",
    "ReplayResult",
    "SCHEDULER_VERSION",
    "Scheduler",
    "build_shadow_scheduler",
    "build_unit_scheduler",
    "card_from_state",
    "rate_unit_with_fsrs",
    "replay_history",
    "should_apply_fsrs",
    "stage_for_interval",
    "state_from_card",
    "state_payload",
]
