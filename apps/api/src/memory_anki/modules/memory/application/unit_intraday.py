"""Same-day (intra-day) spacing for palace review units.

FSRS books in whole study days: a pass lands at least one day out and a failed
grade stays due today. That makes the second encounter of the same day an
accident of queue length — a short session re-serves a failed card immediately,
a long one leaves it for hours, and a new card is never re-checked at all.

This module adds a small product-level ladder on top of FSRS:

- a first-ever pass (and only that) is re-checked once after a short delay;
- ``忘记`` returns after 10 minutes, then an hour, then once more near the end of
  the study day;
- a unit gets at most ``MAX_RETRIES_PER_DAY`` retries, after which it is booked
  for tomorrow instead of being re-served all evening;
- a retry that finally passes books tomorrow directly: the overnight check is
  the confirmation, so no second same-day re-check is stacked on top.

``困难`` is a *pass* on the current policy: it books a shortened day-level
interval (``unit_fsrs_adapter``) and never produces a same-day retry.

Delays are wall-clock, not card counts, so the spacing holds whether the learner
rates quickly or leaves the page open. The FSRS interval itself is untouched:
``plan_intraday`` only decides *when the unit may be served again today*.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

# A first-ever pass is a fragile memory: one short re-check, then the overnight
# check the next day. Twenty minutes is long enough to need retrieval, short
# enough to still be the same study block. See docs/复习排期设计.md.
STEP_DELAY = timedelta(minutes=20)

# Failed grades (``忘记`` only). The third delay is the "today's last" pass; it is
# clamped so it cannot cross the 03:00 study-day boundary.
RETRY_DELAYS: tuple[timedelta, ...] = (
    timedelta(minutes=10),
    timedelta(minutes=60),
    timedelta(minutes=180),
)
MAX_RETRIES_PER_DAY = len(RETRY_DELAYS)

# Keep the last intra-day retry comfortably inside the study day.
DAY_END_MARGIN = timedelta(minutes=15)

FAIL_RATING = 1


@dataclass(frozen=True)
class IntradayState:
    """The intra-day fields persisted on a review unit."""

    day: date | None = None
    due_at: datetime | None = None
    retries: int = 0
    step_pending: bool = False

    @classmethod
    def empty(cls) -> IntradayState:
        return cls()

    def for_day(self, today: date) -> IntradayState:
        """A new study day starts from a clean slate."""
        if self.day != today:
            return IntradayState(day=today)
        return self

    def is_waiting(self, now: datetime) -> bool:
        """True while the unit is booked for later today."""
        return self.due_at is not None and self.due_at > now


@dataclass(frozen=True)
class IntradayPlan:
    """What the product should book after one rating."""

    due_date: date
    due_at: datetime | None
    retries: int
    step_pending: bool
    kind: Literal["retry", "step"] | None
    retry_delay: timedelta | None
    exhausted: bool

    @property
    def waiting(self) -> bool:
        return self.due_at is not None and self.kind is not None


def plan_intraday(
    *,
    state: IntradayState,
    today: date,
    now: datetime,
    rating: int,
    was_passed: bool,
    schedule_locked: bool,
    fsrs_due_date: date,
    day_deadline: datetime,
) -> IntradayPlan:
    """Project one rating onto the intra-day ladder.

    ``fsrs_due_date`` is what the day-level scheduler would book (at least one
    day out for a pass, today for a failure). ``schedule_locked`` marks an
    ahead-of-date filler pass: it records the review without touching the
    schedule, so it also gets no intra-day step. ``was_passed`` is the unit's
    state before this rating, so ``False`` plus a pass is the very first pass.
    """
    current = state.for_day(today)
    passed = int(rating) >= 2

    if passed and schedule_locked:
        # Filler reviews prove nothing; keep today's ladder exactly as it was.
        return IntradayPlan(
            due_date=fsrs_due_date,
            due_at=current.due_at,
            retries=current.retries,
            step_pending=current.step_pending,
            kind=None,
            retry_delay=None,
            exhausted=False,
        )

    if passed:
        if current.step_pending:
            # The 20-minute re-check passed: this is the first real booking.
            # The day-level due date is the anchor's (or FSRS' for a mature
            # card); never keep the unit in today's queue.
            return IntradayPlan(
                due_date=max(fsrs_due_date, today + timedelta(days=1)),
                due_at=None,
                retries=0,
                step_pending=False,
                kind=None,
                retry_delay=None,
                exhausted=False,
            )
        first_pass = not was_passed and current.retries == 0
        if first_pass and int(rating) < 4:
            # A brand-new card gets one short re-check before the day-level
            # interval is booked. 轻松 skips it and books three days out.
            return IntradayPlan(
                due_date=today,
                due_at=_clamp(now + STEP_DELAY, day_deadline),
                retries=current.retries,
                step_pending=True,
                kind="step",
                retry_delay=STEP_DELAY,
                exhausted=False,
            )
        if current.retries > 0:
            # A 忘记 retry finally passed. The overnight check tomorrow is the
            # confirmation; stacking a same-day re-check on it would make one
            # failure cost two visits for no extra evidence.
            return IntradayPlan(
                due_date=today + timedelta(days=1),
                due_at=None,
                retries=0,
                step_pending=False,
                kind=None,
                retry_delay=None,
                exhausted=False,
            )
        # A normal pass on a card that already had its re-check: FSRS owns it.
        return IntradayPlan(
            due_date=max(fsrs_due_date, today + timedelta(days=1)),
            due_at=None,
            retries=0,
            step_pending=False,
            kind=None,
            retry_delay=None,
            exhausted=False,
        )

    retries = current.retries + 1
    if retries > MAX_RETRIES_PER_DAY:
        # Three failed retries is enough for one day. Book tomorrow so the unit
        # stops dominating today's queue; FSRS already holds the lapse evidence.
        return IntradayPlan(
            due_date=today + timedelta(days=1),
            due_at=None,
            retries=0,
            step_pending=False,
            kind=None,
            retry_delay=None,
            exhausted=True,
        )

    delay = RETRY_DELAYS[retries - 1]
    due_at = _clamp(now + delay, day_deadline)
    if due_at <= now:
        # The study day is nearly over; there is no room left for another pass.
        return IntradayPlan(
            due_date=today + timedelta(days=1),
            due_at=None,
            retries=retries,
            step_pending=False,
            kind=None,
            retry_delay=None,
            exhausted=True,
        )
    return IntradayPlan(
        due_date=today,
        due_at=due_at,
        retries=retries,
        step_pending=False,
        kind="retry",
        retry_delay=delay,
        exhausted=False,
    )


def apply_plan(state: IntradayState, plan: IntradayPlan, *, today: date) -> IntradayState:
    """Persistable state after a plan."""
    return IntradayState(
        day=today,
        due_at=plan.due_at,
        retries=plan.retries,
        step_pending=plan.step_pending,
    )


def minutes_until(due_at: datetime | None, now: datetime) -> int | None:
    """Whole minutes until the next same-day appearance, for the UI label."""
    if due_at is None:
        return None
    return max(1, round((due_at - now).total_seconds() / 60))


def _clamp(value: datetime, deadline: datetime) -> datetime:
    return min(value, deadline)
