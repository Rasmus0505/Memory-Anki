"""Product rules on top of FSRS: anchor phase, guardrails, retries.

FSRS owns the intervals; these tests pin the rules the product adds on top of it:
the two-checkpoint anchor phase for new cards, 困难 as a pass that never
lengthens an interval, 忘记 as the only same-day retry, a pass always booking at
least one day out, locked fill cards that do not move, and sprint mode that only
shortens. ``INTERVAL_DAYS`` survives as a display projection, so the old stage
arithmetic is still asserted where it is the compatibility surface rather than
the scheduler.
"""

from datetime import date, datetime, time, timedelta

from fsrs import State

from memory_anki.modules.memory.application.unit_fsrs_adapter import (
    ANCHOR_GRADUATED_STEP,
    FsrsUnitState,
    migrate_legacy_early_step,
    replay_history,
)
from memory_anki.modules.memory.application.unit_intraday import IntradayState
from memory_anki.modules.memory.application.unit_scheduler import (
    FUZZ_MIN_INTERVAL_DAYS,
    FUZZ_RATIO,
    INTERVAL_DAYS,
    MIN_PASSED_STAGE,
    assert_schedulable_due,
    clamp_schedulable_due,
    latest_schedulable_due,
    rate_unit,
    scheduled_interval_days,
)

TODAY = date(2026, 8, 7)
TOP_STAGE = len(INTERVAL_DAYS) - 1


def _state(
    *,
    stability: float = 10.0,
    last_review: date | None = None,
    difficulty: float = 5.0,
) -> FsrsUnitState:
    reviewed = last_review or (TODAY - timedelta(days=10))
    stamp = datetime.combine(reviewed, time(4))
    return FsrsUnitState(
        stability=stability,
        difficulty=difficulty,
        fsrs_state=int(State.Review),
        step=None,
        due_at=stamp,
        last_review=stamp,
    )


def _rate(**overrides):
    kwargs = dict(
        stage_index=9,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=TODAY,
        booked_due_date=TODAY,
        early_step=ANCHOR_GRADUATED_STEP,
        fsrs_state=_state(),
    )
    kwargs.update(overrides)
    return rate_unit(**kwargs)


def test_ladder_shape_is_kept_for_legacy_rows():
    """Old rows and stored snapshots still use these stage numbers."""
    assert INTERVAL_DAYS == (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)


def test_legacy_counter_maps_onto_the_two_checkpoint_anchor():
    assert migrate_legacy_early_step(None) is None
    assert migrate_legacy_early_step(0) == 0
    for old in (1, 2, 3):
        assert migrate_legacy_early_step(old) == ANCHOR_GRADUATED_STEP


# --- 困难 is a pass -----------------------------------------------------------


def test_hard_never_books_today_and_never_lengthens_the_gap():
    result = _rate(rating=2)

    assert result.passed is True
    assert result.retry_after_cards == 0
    assert result.due_date > TODAY
    assert (result.due_date - TODAY).days <= 10


def test_hard_on_a_young_gap_stays_inside_the_band():
    result = _rate(rating=2, fsrs_state=_state(last_review=TODAY - timedelta(days=3)))

    gap = (result.due_date - TODAY).days
    assert 2 <= gap <= 3


def test_hard_on_a_mature_gap_keeps_the_same_gap_at_most():
    result = _rate(rating=2, fsrs_state=_state(last_review=TODAY - timedelta(days=60)))

    assert (result.due_date - TODAY).days <= 60
    assert (result.due_date - TODAY).days >= 48


def test_forgetting_retries_today_and_resets_the_display_band():
    result = _rate(rating=1)

    assert result.passed is False
    assert result.due_date == TODAY
    assert result.retry_after_cards == 3
    assert result.stage_index == 0
    assert result.intraday_kind == "retry"
    assert result.retry_after_minutes == 10


def test_forgetting_a_mature_unit_collapses_stability():
    before = _rate(rating=3)
    assert before.fsrs_state is not None
    before_stability = before.fsrs_state.stability or 0

    lapsed = _rate(rating=1, fsrs_state=before.fsrs_state)
    assert lapsed.fsrs_state is not None
    assert (lapsed.fsrs_state.stability or 0) < before_stability


# --- 记得 / 轻松 caps ---------------------------------------------------------


def test_remember_is_capped_at_two_and_a_half_times_below_ten_days():
    result = _rate(
        rating=3,
        fsrs_state=_state(stability=50.0, last_review=TODAY - timedelta(days=3)),
    )

    assert (result.due_date - TODAY).days == 7


def test_easy_is_capped_at_three_and_a_half_times_below_ten_days():
    result = _rate(
        rating=4,
        fsrs_state=_state(stability=50.0, last_review=TODAY - timedelta(days=3)),
    )

    assert (result.due_date - TODAY).days == 10


def test_the_cap_lifts_from_ten_days():
    result = _rate(
        rating=3,
        fsrs_state=_state(stability=50.0, last_review=TODAY - timedelta(days=10)),
    )

    assert (result.due_date - TODAY).days > 25


def test_a_pass_always_books_at_least_one_day():
    for stage in range(len(INTERVAL_DAYS)):
        result = _rate(stage_index=stage, rating=3)
        assert result.passed is True
        assert (result.due_date - TODAY).days >= 1


def test_top_stage_stays_capped_at_one_year():
    for rating in (3, 4):
        result = _rate(
            stage_index=TOP_STAGE,
            rating=rating,
            fsrs_state=_state(stability=365.0, last_review=TODAY - timedelta(days=365)),
        )
        assert result.stage_index == TOP_STAGE
        assert (result.due_date - TODAY).days == INTERVAL_DAYS[TOP_STAGE]


# --- Anchor phase -------------------------------------------------------------


def test_a_first_pass_gets_one_twenty_minute_recheck_today():
    for rating in (2, 3):
        first = rate_unit(
            stage_index=0,
            has_passed=False,
            rating=rating,
            had_failure_in_encounter=False,
            today=TODAY,
            booked_due_date=TODAY,
            early_step=0,
        )
        assert first.passed is True
        assert first.due_date == TODAY
        assert first.intraday_kind == "step"
        assert first.retry_after_minutes == 20
        assert first.early_step == 0
        assert first.stage_index >= MIN_PASSED_STAGE


def test_a_first_pass_rated_easy_skips_the_recheck():
    first = rate_unit(
        stage_index=0,
        has_passed=False,
        rating=4,
        had_failure_in_encounter=False,
        today=TODAY,
        booked_due_date=TODAY,
        early_step=0,
    )

    assert first.due_date == TODAY + timedelta(days=3)
    assert first.intraday_kind is None
    assert first.early_step == ANCHOR_GRADUATED_STEP


def test_the_recheck_passing_books_tomorrow():
    graduated = rate_unit(
        stage_index=1,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=TODAY,
        intraday=IntradayState(day=TODAY, step_pending=True),
        booked_due_date=TODAY,
        early_step=0,
    )

    assert graduated.due_date == TODAY + timedelta(days=1)
    assert graduated.intraday_kind is None
    # The re-check only closes the same-day step; the overnight check is still
    # owed, so the card stays anchored.
    assert graduated.early_step == 0


def test_the_overnight_check_remember_books_three_days_and_graduates():
    overnight = _rate(
        stage_index=1,
        rating=3,
        booked_due_date=TODAY,
        early_step=0,
        fsrs_state=_state(last_review=TODAY - timedelta(days=1), stability=1.5),
    )

    assert overnight.due_date == TODAY + timedelta(days=3)
    assert overnight.early_step == ANCHOR_GRADUATED_STEP


def test_the_overnight_check_easy_books_five_days_and_graduates():
    overnight = _rate(
        stage_index=1,
        rating=4,
        booked_due_date=TODAY,
        early_step=0,
        fsrs_state=_state(last_review=TODAY - timedelta(days=1), stability=1.5),
    )

    assert overnight.due_date == TODAY + timedelta(days=5)
    assert overnight.early_step == ANCHOR_GRADUATED_STEP


def test_the_overnight_check_hard_books_one_more_overnight():
    overnight = _rate(
        stage_index=1,
        rating=2,
        booked_due_date=TODAY,
        early_step=0,
        fsrs_state=_state(last_review=TODAY - timedelta(days=1), stability=1.5),
    )

    assert overnight.passed is True
    assert overnight.due_date == TODAY + timedelta(days=1)
    assert overnight.early_step == 0


def test_forgetting_during_the_anchor_phase_restarts_the_overnight_check():
    result = _rate(
        stage_index=1,
        rating=1,
        booked_due_date=TODAY,
        early_step=0,
        fsrs_state=_state(last_review=TODAY - timedelta(days=1), stability=1.5),
    )

    assert result.due_date == TODAY
    assert result.early_step == 0
    assert result.intraday_kind == "retry"


# --- Locked fill cards --------------------------------------------------------


def test_locked_pass_records_review_without_moving_the_schedule():
    booked = date(2026, 9, 1)
    result = _rate(
        stage_index=5,
        rating=4,
        schedule_locked=True,
        locked_due_date=booked,
    )

    assert result.passed is True
    assert result.schedule_changed is False
    assert result.stage_index == 5
    assert result.due_date == booked
    assert result.retry_after_cards == 0


def test_locked_hard_also_records_without_moving_the_schedule():
    booked = date(2026, 9, 1)
    result = _rate(
        stage_index=5,
        rating=2,
        schedule_locked=True,
        locked_due_date=booked,
    )

    assert result.passed is True
    assert result.schedule_changed is False
    assert result.due_date == booked


def test_forget_still_lapses_when_the_schedule_is_locked():
    result = _rate(
        stage_index=5,
        rating=1,
        schedule_locked=True,
        locked_due_date=date(2026, 9, 1),
    )

    assert result.passed is False
    assert result.schedule_changed is True
    assert result.due_date == TODAY
    assert result.stage_index == 0


# --- Lapse recovery -----------------------------------------------------------


def test_a_mature_forget_records_the_earned_interval():
    result = _rate(
        rating=1,
        fsrs_state=_state(last_review=TODAY - timedelta(days=60), stability=60.0),
    )

    assert result.lapse_original_days == 60
    assert result.lapse_started_on == TODAY


def test_the_overnight_confirmation_restores_thirty_percent():
    lapsed = _rate(
        rating=1,
        fsrs_state=_state(last_review=TODAY - timedelta(days=60), stability=60.0),
    )
    confirmed = rate_unit(
        stage_index=lapsed.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=TODAY + timedelta(days=1),
        booked_due_date=TODAY,
        early_step=lapsed.early_step,
        fsrs_state=lapsed.fsrs_state,
        lapse_original_days=lapsed.lapse_original_days,
        lapse_started_on=lapsed.lapse_started_on,
    )

    assert (confirmed.due_date - (TODAY + timedelta(days=1))).days == 18
    assert confirmed.lapse_original_days is None
    assert confirmed.lapse_started_on is None


def test_a_young_forget_does_not_enter_recovery():
    result = _rate(
        rating=1,
        fsrs_state=_state(last_review=TODAY - timedelta(days=5), stability=5.0),
    )

    assert result.lapse_original_days is None


# --- Legacy rows, fuzz and sprint --------------------------------------------


def test_a_row_without_fsrs_state_continues_from_its_legacy_position():
    """Inherited and pre-switch rows have no FSRS checkpoint yet.

    Passing an empty state must not make a mature unit look brand new: the
    scheduler seeds from the row's stage/due date instead of booking one day.
    """
    result = rate_unit(
        stage_index=9,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=TODAY,
        fsrs_state=FsrsUnitState(),
    )
    assert result.passed is True
    assert (result.due_date - TODAY).days >= 300


def test_without_a_fuzz_key_intervals_are_exactly_nominal():
    """Keeps existing pinned dates and test determinism intact."""
    for stage in range(len(INTERVAL_DAYS)):
        assert scheduled_interval_days(stage) == INTERVAL_DAYS[stage]


def test_fuzz_is_deterministic_per_unit_so_preview_matches_commit():
    for stage in range(len(INTERVAL_DAYS)):
        first = scheduled_interval_days(stage, fuzz_key="unit-abc")
        second = scheduled_interval_days(stage, fuzz_key="unit-abc")
        assert first == second


def test_fuzz_leaves_short_intervals_exact():
    for stage in range(len(INTERVAL_DAYS)):
        if INTERVAL_DAYS[stage] < FUZZ_MIN_INTERVAL_DAYS:
            assert scheduled_interval_days(stage, fuzz_key="unit-abc") == INTERVAL_DAYS[stage]


def test_fuzz_scatters_a_same_day_cohort_within_bounds():
    """Same-day cohorts used to stay locked together forever on every stage."""
    stage = 3
    nominal = INTERVAL_DAYS[stage]
    span = max(1, round(nominal * FUZZ_RATIO))
    observed = {scheduled_interval_days(stage, fuzz_key=f"unit-{i}") for i in range(50)}
    assert len(observed) > 1
    for value in observed:
        assert value >= 1
        assert abs(value - nominal) <= span


def test_absurd_future_due_is_not_a_schedule():
    today = date(2026, 10, 9)
    limit = latest_schedulable_due(today)
    assert limit == date(2027, 10, 27)
    assert clamp_schedulable_due(date(2099, 1, 1), today=today) == today
    assert clamp_schedulable_due(limit, today=today) == limit
    assert clamp_schedulable_due(date(2026, 10, 5), today=today) == date(2026, 10, 5)
    try:
        assert_schedulable_due(date(2099, 1, 1), today=today)
    except ValueError as exc:
        assert "一年" in str(exc)
    else:
        raise AssertionError("a date past the ladder must be rejected")


def test_inheritance_rejects_a_parked_future_due_instead_of_rebooking():
    from types import SimpleNamespace

    import pytest

    from memory_anki.modules.memory.application.unit_inheritance import inheritance_vote

    today = date(2026, 10, 9)
    with pytest.raises(ValueError, match="一年"):
        inheritance_vote(
            [
                SimpleNamespace(stage_index=1, due_date=today, has_passed=True),
                SimpleNamespace(stage_index=2, due_date=date(2099, 6, 1), has_passed=True),
            ],
            default_stage=0,
            default_due=today,
        )


def test_fuzz_never_produces_a_non_positive_interval():
    for stage in range(1, len(INTERVAL_DAYS)):
        for index in range(200):
            assert scheduled_interval_days(stage, fuzz_key=f"u{index}") >= 1


# --- Sprint horizon -----------------------------------------------------------
# A fixed exam date bounds the booking: nothing may be scheduled after the exam,
# overshooting intervals are pulled into the last week, and the ladder itself
# (landing stage, nominal interval, toolbar histogram) is untouched.


from memory_anki.core.exam_horizon import resolve_sprint_horizon  # noqa: E402

EXAM = date(2026, 12, 20)
SPRINT_TODAY = date(2026, 10, 23)  # 58 days out


def _horizon(today: date = SPRINT_TODAY):
    return resolve_sprint_horizon(exam_date=EXAM.isoformat(), sprint_mode=True, today=today)


def test_sprint_horizon_is_off_without_the_switch():
    assert resolve_sprint_horizon(exam_date=EXAM.isoformat(), sprint_mode=False, today=TODAY) is None


def test_sprint_horizon_is_off_without_an_exam_date():
    assert resolve_sprint_horizon(exam_date=None, sprint_mode=True, today=TODAY) is None


def test_sprint_horizon_stops_on_exam_day():
    """On the exam day the horizon would pull everything onto "yesterday"."""
    assert resolve_sprint_horizon(exam_date=EXAM.isoformat(), sprint_mode=True, today=EXAM) is None


def test_sprint_never_books_past_the_exam():
    horizon = _horizon()
    for interval in (1, 3, 7, 14, 30, 60, 120, 240, 365):
        assert horizon.schedule(interval, today=SPRINT_TODAY) <= horizon.last_due, interval


def test_sprint_leaves_a_fitting_interval_alone():
    """The ladder decides the cadence; the horizon only bounds it."""
    horizon = _horizon()
    for interval in (1, 3, 7, 14):
        assert horizon.schedule(interval, today=SPRINT_TODAY) == SPRINT_TODAY + timedelta(days=interval)


def test_sprint_pulls_overshooting_reviews_into_the_last_week():
    horizon = _horizon()
    pulled = horizon.schedule(365, today=SPRINT_TODAY, seed="unit-1")
    assert horizon.last_due - timedelta(days=6) <= pulled <= horizon.last_due


def test_sprint_spreads_the_pulled_cohort():
    """A mature cohort must not all arrive on the eve of the exam."""
    horizon = _horizon()
    days = {
        horizon.schedule(365, today=SPRINT_TODAY, seed=f"unit-{index}")
        for index in range(40)
    }
    assert len(days) >= 4, "pulled reviews collapsed onto too few days"


def test_sprint_books_normally_when_no_room_is_left():
    """Reviewed two days before the exam: there is nothing left to pull into."""
    horizon = _horizon(date(2026, 12, 18))
    assert horizon.schedule(30, today=date(2026, 12, 18), seed="unit-1") == date(2027, 1, 17)


def test_pass_under_sprint_books_before_the_exam():
    horizon = _horizon()
    result = rate_unit(
        stage_index=6,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=SPRINT_TODAY,
        fuzz_key="unit-1",
        horizon=horizon,
    )
    assert result.passed is True
    assert result.due_date <= horizon.last_due


def test_sprint_does_not_change_the_landing_stage():
    """The cap moves the booked date only; the stage still names the grade."""
    horizon = _horizon()
    plain = rate_unit(
        stage_index=5, has_passed=True, rating=3,
        had_failure_in_encounter=False, today=SPRINT_TODAY, fuzz_key="unit-1",
    )
    bounded = rate_unit(
        stage_index=5, has_passed=True, rating=3,
        had_failure_in_encounter=False, today=SPRINT_TODAY, fuzz_key="unit-1",
        horizon=horizon,
    )
    assert bounded.stage_index == plain.stage_index == 6
    assert plain.due_date > horizon.last_due
    assert bounded.due_date <= horizon.last_due


def test_locked_ahead_of_date_card_keeps_its_booked_date():
    """A fill card proves nothing about retention, so sprint mode must not move it.

    Its post-exam date is pulled by ``clamp_due_dates_for_sprint`` instead, which
    is the one write path allowed to touch a booked due date.
    """
    horizon = _horizon()
    booked = date(2027, 2, 18)
    result = rate_unit(
        stage_index=5,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=SPRINT_TODAY,
        schedule_locked=True,
        locked_due_date=booked,
        horizon=horizon,
    )
    assert result.schedule_changed is False
    assert result.due_date == booked


def test_forgetting_still_retries_today_under_sprint():
    horizon = _horizon()
    result = rate_unit(
        stage_index=6,
        has_passed=True,
        rating=1,
        had_failure_in_encounter=False,
        today=SPRINT_TODAY,
        horizon=horizon,
    )
    assert result.due_date == SPRINT_TODAY
    assert result.passed is False


def test_hard_under_sprint_books_a_day_not_today():
    horizon = _horizon()
    result = rate_unit(
        stage_index=6,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=False,
        today=SPRINT_TODAY,
        horizon=horizon,
    )
    assert result.passed is True
    assert result.due_date > SPRINT_TODAY


# --- Replay -------------------------------------------------------------------


def test_replay_reproduces_the_anchor_and_the_guardrails():
    from types import SimpleNamespace

    def before(day: date, *, early_step: int, has_passed: bool, due: date) -> str:
        import json

        return json.dumps(
            {
                "state": {
                    "stage_index": 1,
                    "has_passed": has_passed,
                    "due_date": due.isoformat(),
                    "early_step": early_step,
                }
            }
        )

    learned = date(2026, 9, 1)
    operations = [
        SimpleNamespace(
            created_at=datetime(2026, 9, 1, 4),
            rating=3,
            before_state_json=before(learned, early_step=0, has_passed=False, due=learned),
        ),
        SimpleNamespace(
            created_at=datetime(2026, 9, 2, 4),
            rating=3,
            before_state_json=before(
                learned, early_step=0, has_passed=True, due=learned + timedelta(days=1)
            ),
        ),
        SimpleNamespace(
            created_at=datetime(2026, 9, 5, 4),
            rating=3,
            before_state_json=before(
                learned, early_step=1, has_passed=True, due=learned + timedelta(days=4)
            ),
        ),
    ]

    replay = replay_history(operations, unit_id="unit-replay")

    assert replay.early_step == ANCHOR_GRADUATED_STEP
    assert replay.has_passed is True
    assert replay.due_date is not None
    # Day 5 → the first FSRS booking, capped at 2.5x the three-day gap (7 days,
    # plus at most one day of the per-unit ±5% spread).
    assert 7 <= (replay.due_date - date(2026, 9, 5)).days <= 8
