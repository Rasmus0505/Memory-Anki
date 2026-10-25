"""Same-day spacing: short step for new learning, expanding retries, hard cap."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from memory_anki.modules.memory.application.unit_intraday import (
    MAX_RETRIES_PER_DAY,
    STEP_DELAY,
    IntradayState,
    minutes_until,
    plan_intraday,
)

TODAY = date(2026, 10, 25)
NOW = datetime(2026, 10, 25, 14, 0)  # 22:00 Beijing
DEADLINE = datetime(2026, 10, 26, 2, 45)  # 03:00 study-day rollover minus margin
TOMORROW = date(2026, 10, 26)


def _plan(**overrides):
    kwargs = dict(
        state=IntradayState.empty(),
        today=TODAY,
        now=NOW,
        rating=3,
        was_passed=True,
        schedule_locked=False,
        fsrs_due_date=TODAY + timedelta(days=1),
        day_deadline=DEADLINE,
    )
    kwargs.update(overrides)
    return plan_intraday(**kwargs)


def test_a_first_pass_gets_one_short_recheck_today():
    plan = _plan(was_passed=False)

    assert plan.kind == "step"
    assert plan.due_date == TODAY
    assert plan.due_at == NOW + STEP_DELAY
    assert plan.step_pending is True


def test_a_step_that_passes_graduates_to_tomorrow():
    waiting = IntradayState(day=TODAY, due_at=NOW + STEP_DELAY, step_pending=True)

    plan = _plan(state=waiting, was_passed=False, now=NOW + STEP_DELAY)

    assert plan.kind is None
    assert plan.step_pending is False
    assert plan.due_at is None
    # A card learned today belongs to tomorrow even if FSRS saw two passes.
    assert plan.due_date == TODAY + timedelta(days=1)


def test_a_mature_pass_does_not_get_a_step():
    plan = _plan(was_passed=True, fsrs_due_date=TODAY + timedelta(days=30))

    assert plan.kind is None
    assert plan.due_date == TODAY + timedelta(days=30)


def test_a_retry_that_passes_gets_one_thirty_minute_recheck():
    """重练卡独立规则：被评为记得后，30 分钟后再过一遍。"""
    retry = IntradayState(day=TODAY, retries=2)

    plan = _plan(state=retry, was_passed=True)

    assert STEP_DELAY == timedelta(minutes=30)
    assert plan.kind == "step"
    assert plan.due_at == NOW + timedelta(minutes=30)
    assert plan.step_pending is True
    # The day's retry budget is preserved so a failed re-check continues the
    # same ladder instead of restarting it.
    assert plan.retries == 2


def test_a_retry_recheck_graduates_to_the_adapter_booking():
    waiting = IntradayState(day=TODAY, retries=2, due_at=NOW + STEP_DELAY, step_pending=True)

    plan = _plan(
        state=waiting,
        was_passed=True,
        fsrs_due_date=TODAY + timedelta(days=5),
        now=NOW + STEP_DELAY,
    )

    assert plan.kind is None
    assert plan.step_pending is False
    assert plan.due_date == TODAY + timedelta(days=5)


def test_a_locked_filler_pass_leaves_the_ladder_alone():
    locked_due = TODAY + timedelta(days=12)

    plan = _plan(was_passed=False, schedule_locked=True, fsrs_due_date=locked_due)

    assert plan.kind is None
    assert plan.due_date == locked_due
    assert plan.due_at is None


def test_failures_expand_ten_minutes_then_an_hour_then_three_hours():
    second_now = NOW + timedelta(minutes=10)
    third_now = NOW + timedelta(minutes=70)
    first = _plan(rating=2, was_passed=True)
    second = _plan(rating=2, state=IntradayState(day=TODAY, retries=1), now=second_now)
    third = _plan(rating=2, state=IntradayState(day=TODAY, retries=2), now=third_now)

    assert first.due_at == NOW + timedelta(minutes=10)
    assert second.due_at == second_now + timedelta(minutes=60)
    assert third.due_at == third_now + timedelta(minutes=180)
    assert [first.retries, second.retries, third.retries] == [1, 2, 3]


def test_the_fourth_failure_books_tomorrow_and_stops_the_day():
    state = IntradayState(day=TODAY, retries=MAX_RETRIES_PER_DAY)

    plan = _plan(rating=1, state=state)

    assert plan.exhausted is True
    assert plan.due_at is None
    assert plan.due_date >= TOMORROW
    assert plan.retries == 0


def test_a_retry_is_clamped_inside_the_study_day():
    late = datetime(2026, 10, 26, 2, 0)  # 10:00 Beijing, still the 25th's study day

    plan = _plan(rating=2, state=IntradayState(day=TODAY, retries=2), now=late)

    assert plan.due_at == DEADLINE
    assert plan.exhausted is False


def test_no_room_left_in_the_day_books_tomorrow():
    # 02:30 is inside the study day, but the three-hour delay has no room and
    # the deadline has already passed for a 180-minute step.
    near_end = datetime(2026, 10, 26, 2, 50)

    plan = _plan(rating=2, state=IntradayState(day=TODAY, retries=0), now=near_end)

    assert plan.exhausted is True
    assert plan.due_date >= TOMORROW


def test_a_new_study_day_resets_the_ladder():
    yesterday = IntradayState(day=TODAY - timedelta(days=1), retries=2, step_pending=True)

    plan = _plan(state=yesterday, was_passed=True, rating=2)

    assert plan.retries == 1
    assert plan.step_pending is False


def test_state_for_day_resets_and_keeps_the_same_day():
    state = IntradayState(day=TODAY, retries=2, step_pending=True)

    assert state.for_day(TODAY) == state
    reset = state.for_day(TODAY + timedelta(days=1))
    assert reset.due_at is None and reset.retries == 0 and reset.step_pending is False


def test_minutes_until_rounds_to_whole_minutes():
    assert minutes_until(NOW + timedelta(minutes=10, seconds=20), NOW) == 10
    assert minutes_until(None, NOW) is None
