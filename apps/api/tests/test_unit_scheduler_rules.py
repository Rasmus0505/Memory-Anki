"""FSRS transition rules behind the product guard rails.

FSRS owns the intervals; these tests pin the rules the product adds on top of it:
忘记/困难 retry on the same study day, 困难 demotes the display projection only
once per day, a pass always books at least one day out, locked fill cards do not
move, and sprint mode only shortens. ``INTERVAL_DAYS`` survives as a display
projection, so the old stage arithmetic is still asserted where it is the
compatibility surface rather than the scheduler.
"""

from datetime import date, timedelta

from memory_anki.modules.memory.application.unit_fsrs_adapter import (
    EARLY_LADDER_STEPS,
    FsrsUnitState,
    growth_cap_days,
    replay_history,
)
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


def test_ladder_shape_is_kept_for_legacy_rows():
    """Old rows and stored snapshots still use these stage numbers."""
    assert INTERVAL_DAYS == (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)


def test_hard_on_a_mature_unit_retries_after_three_cards():
    """困难 lowers earned credit but remains retry work until a pass."""
    result = rate_unit(
        stage_index=9,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=False,
        today=TODAY,
    )
    assert result.passed is False
    assert result.retry_after_cards == 3
    assert result.stage_index == 8
    assert result.due_date == TODAY


def test_hard_always_retries_and_penalizes_mature_stage():
    for stage in range(1, len(INTERVAL_DAYS)):
        result = rate_unit(
            stage_index=stage,
            has_passed=True,
            rating=2,
            had_failure_in_encounter=False,
            today=TODAY,
        )
        assert result.passed is False, f"stage {stage}"
        assert result.retry_after_cards == 3, f"stage {stage}"
        assert result.stage_index == stage - 1, f"stage {stage}"
        assert result.due_date == TODAY, f"stage {stage}"


def test_hard_on_a_never_passed_unit_still_retries_same_day():
    """First-learning hard ratings keep the unit at stage 0."""
    result = rate_unit(
        stage_index=0,
        has_passed=False,
        rating=2,
        had_failure_in_encounter=False,
        today=TODAY,
    )
    assert (result.stage_index, result.due_date, result.passed) == (0, TODAY, False)
    assert result.retry_after_cards == 3


def test_hard_after_a_prior_failure_retries_again_with_stage_penalty():
    result = rate_unit(
        stage_index=5,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=True,
        today=TODAY,
    )
    assert result.passed is False
    assert result.retry_after_cards == 3
    assert result.stage_index == 4
    assert result.due_date == TODAY


def test_forgetting_a_mature_unit_collapses_stability_and_retries_today():
    """忘记 books a same-day retry and tells FSRS the memory was overestimated."""
    learned = rate_unit(
        stage_index=9,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=TODAY,
    )
    assert learned.fsrs_state is not None
    before_stability = learned.fsrs_state.stability or 0

    lapsed = rate_unit(
        stage_index=9,
        has_passed=True,
        rating=1,
        had_failure_in_encounter=False,
        today=TODAY,
        fsrs_state=learned.fsrs_state,
    )
    assert lapsed.passed is False
    assert lapsed.due_date == TODAY
    assert lapsed.retry_after_cards == 3
    assert lapsed.stage_index == 0
    assert lapsed.hard_penalty_applied is False
    assert lapsed.fsrs_state is not None
    assert (lapsed.fsrs_state.stability or 0) < before_stability / 2
    # FSRS raises difficulty on a lapse, so the next pass books a shorter
    # interval than the memory state had before the failure.
    assert (lapsed.fsrs_state.difficulty or 0) > (learned.fsrs_state.difficulty or 0)

    relearned = rate_unit(
        stage_index=lapsed.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=True,
        today=TODAY,
        fsrs_state=lapsed.fsrs_state,
    )
    assert relearned.passed is True
    gap = (relearned.due_date - TODAY).days
    assert gap >= INTERVAL_DAYS[MIN_PASSED_STAGE]
    assert gap < (learned.due_date - TODAY).days, "the lapse did not shorten the interval"
    assert relearned.stage_index >= MIN_PASSED_STAGE


def test_forgetting_ignores_the_once_per_day_hard_marker():
    """A 忘记 after a 困难 the same day still drops to the 忘记 level."""
    lapsed = rate_unit(
        stage_index=4,
        has_passed=True,
        rating=1,
        had_failure_in_encounter=True,
        today=TODAY,
        hard_penalized_today=True,
    )
    assert lapsed.stage_index == 0


def test_hard_demotes_only_once_per_day():
    """Repeated 困难 on the same day's retry cards must not keep stepping down."""
    first = rate_unit(
        stage_index=5,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=False,
        today=TODAY,
    )
    assert first.stage_index == 4
    assert first.hard_penalty_applied is True

    again = rate_unit(
        stage_index=first.stage_index,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=True,
        today=TODAY,
        hard_penalized_today=True,
    )
    assert again.stage_index == 4
    assert again.hard_penalty_applied is False
    assert again.passed is False
    assert again.retry_after_cards == 3
    assert again.due_date == TODAY


def test_hard_on_a_never_passed_unit_stays_at_first_learning():
    result = rate_unit(
        stage_index=0,
        has_passed=False,
        rating=2,
        had_failure_in_encounter=True,
        today=TODAY,
        hard_penalized_today=True,
    )
    assert (result.stage_index, result.hard_penalty_applied) == (0, False)


def test_a_first_pass_gets_one_same_day_step_then_books_tomorrow():
    """A card learned today is re-checked once, then belongs to tomorrow.

    The old rule booked a first pass at least one day out and never looked at it
    again until then; that is the fragile-memory case the same-day step targets.
    """
    from memory_anki.modules.memory.application.unit_intraday import IntradayState

    for stage in range(len(INTERVAL_DAYS)):
        for rating in (3, 4):
            first = rate_unit(
                stage_index=stage,
                has_passed=False,
                rating=rating,
                had_failure_in_encounter=False,
                today=TODAY,
            )
            assert first.passed is True
            assert first.due_date == TODAY
            assert first.intraday_kind == "step"
            assert first.retry_after_minutes is not None
            assert first.stage_index >= MIN_PASSED_STAGE

    # The re-check passes: tomorrow, never later than that.
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
    assert graduated.passed is True
    assert graduated.due_date == TODAY + timedelta(days=1)
    assert graduated.intraday_kind is None
    assert graduated.early_step == 1


def test_a_mature_pass_still_books_at_least_one_day():
    for stage in range(len(INTERVAL_DAYS)):
        for rating in (3, 4):
            result = rate_unit(
                stage_index=stage,
                has_passed=True,
                rating=rating,
                had_failure_in_encounter=False,
                today=TODAY,
            )
            assert result.passed is True
            assert (result.due_date - TODAY).days >= 1
            assert result.stage_index >= MIN_PASSED_STAGE


def test_top_stage_stays_capped():
    for rating in (3, 4):
        result = rate_unit(
            stage_index=TOP_STAGE,
            has_passed=True,
            rating=rating,
            had_failure_in_encounter=False,
            today=TODAY,
        )
        assert result.stage_index == TOP_STAGE
        assert (result.due_date - TODAY).days == INTERVAL_DAYS[TOP_STAGE]


def test_locked_pass_records_review_without_moving_the_ladder():
    booked = date(2026, 9, 1)
    result = rate_unit(
        stage_index=5,
        has_passed=True,
        rating=4,
        had_failure_in_encounter=False,
        today=TODAY,
        schedule_locked=True,
        locked_due_date=booked,
    )
    assert result.passed is True
    assert result.schedule_changed is False
    assert result.stage_index == 5
    assert result.due_date == booked
    assert result.retry_after_cards == 0


def test_forget_still_lapses_when_the_schedule_is_locked():
    result = rate_unit(
        stage_index=5,
        has_passed=True,
        rating=1,
        had_failure_in_encounter=False,
        today=TODAY,
        schedule_locked=True,
        locked_due_date=date(2026, 9, 1),
    )
    assert result.passed is False
    assert result.schedule_changed is True
    assert result.due_date == TODAY
    assert result.stage_index == 0


def test_hard_on_a_locked_fill_unit_still_retries_and_changes_schedule():
    booked = date(2026, 9, 1)
    result = rate_unit(
        stage_index=5,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=False,
        today=TODAY,
        schedule_locked=True,
        locked_due_date=booked,
    )
    assert result.passed is False
    assert result.retry_after_cards == 3
    assert result.schedule_changed is True
    assert result.stage_index == 4
    assert result.due_date == TODAY


def test_a_row_without_fsrs_state_continues_from_its_legacy_position():
    """Inherited and pre-switch rows have no FSRS checkpoint yet.

    Passing an empty state must not make a mature unit look brand new: the
    scheduler seeds from the row's stage/due date instead of booking one day.
    """
    from memory_anki.modules.memory.application.unit_fsrs_adapter import FsrsUnitState

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


def test_failed_ratings_still_retry_today_under_sprint():
    horizon = _horizon()
    for rating in (1, 2):
        result = rate_unit(
            stage_index=6,
            has_passed=True,
            rating=rating,
            had_failure_in_encounter=False,
            today=SPRINT_TODAY,
            horizon=horizon,
        )
        assert result.due_date == SPRINT_TODAY
        assert result.passed is False


# --- Fixed early ladder -----------------------------------------------------
# The first three day-level bookings are product-fixed: tomorrow, two days, three
# days. FSRS takes over from the review that comes back after those three days,
# under the young-unit growth ceiling (never more than double the booked gap).
# The ladder keys off the *booked* gap, because a 困难 raises FSRS stability
# while the product still treats it as retry work.

EARLY_TODAY = date(2026, 8, 7)


def _early_state(*, stability: float = 1.3359, last_review: date = date(2026, 8, 6)):
    from datetime import datetime

    return FsrsUnitState(
        stability=stability,
        difficulty=5.1023,
        fsrs_state=2,
        step=None,
        due_at=datetime(2026, 8, 7, 4),
        last_review=datetime.combine(last_review, datetime.min.time()).replace(hour=4),
    )


def test_early_ladder_walks_one_one_two_days():
    """Fixed reviews land on day 2, day 3 and day 5 (gaps 1, 1, 2)."""
    for early_step, expected in ((0, 1), (1, 1), (2, 2)):
        result = rate_unit(
            stage_index=min(early_step + 1, 9),
            has_passed=True,
            rating=3,
            had_failure_in_encounter=False,
            today=EARLY_TODAY,
            fsrs_state=_early_state(last_review=EARLY_TODAY - timedelta(days=1)),
            booked_due_date=EARLY_TODAY,
            early_step=early_step,
        )
        assert result.due_date == EARLY_TODAY + timedelta(days=expected), early_step
        assert result.early_step == early_step + 1
        # `stage_index` is a coarse compatibility bucket (0/1/3/7…), so a
        # two-day booking still projects to stage 1; the due date is the truth.
        assert result.stage_index >= 1


def test_easy_jumps_to_the_last_fixed_step():
    result = rate_unit(
        stage_index=1,
        has_passed=True,
        rating=4,
        had_failure_in_encounter=False,
        today=EARLY_TODAY,
        fsrs_state=_early_state(last_review=EARLY_TODAY - timedelta(days=1)),
        booked_due_date=EARLY_TODAY,
        early_step=0,
    )
    assert result.due_date == EARLY_TODAY + timedelta(days=2)
    assert result.early_step == EARLY_LADDER_STEPS


def test_forgetting_restarts_the_fixed_ladder():
    result = rate_unit(
        stage_index=2,
        has_passed=True,
        rating=1,
        had_failure_in_encounter=False,
        today=EARLY_TODAY,
        fsrs_state=_early_state(last_review=EARLY_TODAY - timedelta(days=1)),
        booked_due_date=EARLY_TODAY,
        early_step=2,
    )
    assert result.due_date == EARLY_TODAY
    assert result.early_step == 0


def test_new_card_walks_the_fixed_four_reviews_then_fsrs():
    """30 分钟 → 第2天 → 第3天 → 第5天 → FSRS，按学习当天计数。"""
    from memory_anki.modules.memory.application.unit_intraday import IntradayState

    learned = EARLY_TODAY
    first = rate_unit(
        stage_index=0,
        has_passed=False,
        rating=3,
        had_failure_in_encounter=False,
        today=learned,
        booked_due_date=learned,
    )
    assert first.due_date == learned
    assert first.intraday_kind == "step"
    assert first.retry_after_minutes == 30
    assert first.early_step == 0

    recheck = rate_unit(
        stage_index=first.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=learned,
        intraday=IntradayState(day=learned, step_pending=True),
        booked_due_date=learned,
        early_step=first.early_step,
        fsrs_state=first.fsrs_state,
    )
    assert recheck.due_date == learned + timedelta(days=1)
    assert recheck.early_step == 1

    review_2 = rate_unit(
        stage_index=recheck.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=learned + timedelta(days=1),
        booked_due_date=learned + timedelta(days=1),
        early_step=recheck.early_step,
        fsrs_state=recheck.fsrs_state,
    )
    assert review_2.due_date == learned + timedelta(days=2)
    assert review_2.early_step == 2

    review_3 = rate_unit(
        stage_index=review_2.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=learned + timedelta(days=2),
        booked_due_date=learned + timedelta(days=2),
        early_step=review_2.early_step,
        fsrs_state=review_2.fsrs_state,
    )
    assert review_3.due_date == learned + timedelta(days=4)
    assert review_3.early_step == 3

    review_4 = rate_unit(
        stage_index=review_3.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=learned + timedelta(days=4),
        booked_due_date=learned + timedelta(days=4),
        early_step=review_3.early_step,
        fsrs_state=review_3.fsrs_state,
    )
    # The fifth booking is FSRS' own (still under the 2x young-unit ceiling).
    assert (review_4.due_date - (learned + timedelta(days=4))).days >= 1
    assert review_4.early_step == EARLY_LADDER_STEPS


def test_fsrs_takes_over_after_the_fixed_four_reviews():
    result = rate_unit(
        stage_index=3,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=EARLY_TODAY,
        fsrs_state=_early_state(stability=19.8, last_review=EARLY_TODAY - timedelta(days=3)),
        booked_due_date=EARLY_TODAY,
    )
    # FSRS wants about 20 days; the young-unit ceiling books twice the last gap.
    assert result.due_date == EARLY_TODAY + timedelta(days=6)


def test_growth_ceiling_shape():
    """Double the booked gap, at least three days, only while the unit is young."""
    assert growth_cap_days(previous_interval_days=None) is None
    assert growth_cap_days(previous_interval_days=0) is None
    assert growth_cap_days(previous_interval_days=1) == 3
    assert growth_cap_days(previous_interval_days=3) == 6
    assert growth_cap_days(previous_interval_days=12) == 24
    assert growth_cap_days(previous_interval_days=30) is None


def test_hard_on_an_early_unit_then_retry_gets_a_30_minute_recheck():
    """The 太学 case: 困难 must not push a one-day unit three days out.

    A 重练 that passes is not stable evidence yet; it gets the same 30-minute
    re-check as a first pass before the day-level interval is booked.
    """
    from memory_anki.modules.memory.application.unit_intraday import IntradayState

    hard = rate_unit(
        stage_index=1,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=False,
        today=EARLY_TODAY,
        fsrs_state=_early_state(),
        booked_due_date=EARLY_TODAY,
    )
    assert hard.due_date == EARLY_TODAY
    assert hard.stage_index == 0
    assert hard.fsrs_state is not None
    assert hard.early_step == 0

    retry = rate_unit(
        stage_index=hard.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=True,
        today=EARLY_TODAY,
        fsrs_state=hard.fsrs_state,
        booked_due_date=EARLY_TODAY,
        early_step=hard.early_step,
        intraday=IntradayState(day=EARLY_TODAY, retries=1),
    )
    assert retry.due_date == EARLY_TODAY
    assert retry.intraday_kind == "step"
    assert retry.retry_after_minutes == 30
    # The deferred booking must not advance the ladder yet.
    assert retry.early_step == 0

    recheck = rate_unit(
        stage_index=retry.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=EARLY_TODAY,
        fsrs_state=retry.fsrs_state,
        booked_due_date=EARLY_TODAY,
        early_step=retry.early_step,
        intraday=IntradayState(day=EARLY_TODAY, retries=1, step_pending=True),
    )
    assert recheck.due_date == EARLY_TODAY + timedelta(days=1)
    assert recheck.early_step == 1
    assert recheck.stage_index == 1


def test_mature_hard_recovery_still_lets_fsrs_book():
    """成熟单元的『困难』重练通过后先 30 分钟复查，再交给 FSRS 排期。"""
    from memory_anki.modules.memory.application.unit_intraday import IntradayState

    hard = rate_unit(
        stage_index=5,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=False,
        today=EARLY_TODAY,
        fsrs_state=_early_state(stability=14.0, last_review=date(2026, 7, 1)),
        booked_due_date=EARLY_TODAY,
    )
    assert hard.due_date == EARLY_TODAY
    assert hard.stage_index == 4
    assert hard.early_step == 3

    retry = rate_unit(
        stage_index=hard.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=True,
        today=EARLY_TODAY,
        fsrs_state=hard.fsrs_state,
        booked_due_date=EARLY_TODAY,
        early_step=hard.early_step,
        intraday=IntradayState(day=EARLY_TODAY, retries=1),
    )
    assert retry.intraday_kind == "step"
    assert retry.due_date == EARLY_TODAY

    recheck = rate_unit(
        stage_index=retry.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=False,
        today=EARLY_TODAY,
        fsrs_state=retry.fsrs_state,
        booked_due_date=EARLY_TODAY,
        early_step=retry.early_step,
        intraday=IntradayState(day=EARLY_TODAY, retries=1, step_pending=True),
    )
    assert (recheck.due_date - EARLY_TODAY).days > 1


def _op(*, day, rating, stage, has_passed, due, fsrs=None, hard_on=None):
    import json
    from datetime import datetime
    from types import SimpleNamespace

    return SimpleNamespace(
        created_at=datetime(day.year, day.month, day.day, 4),
        rating=rating,
        before_state_json=json.dumps(
            {
                "state": {
                    "stage_index": stage,
                    "has_passed": has_passed,
                    "due_date": due.isoformat(),
                    "hard_penalized_on": hard_on,
                    "fsrs": fsrs or {},
                }
            }
        ),
    )


def test_replay_reproduces_the_early_ladder_and_the_hard_recovery():
    """The one-time replay must land where a live rating would."""
    day0 = date(2026, 10, 24)
    day1 = date(2026, 10, 25)
    empty_fsrs = {
        "stability": None,
        "difficulty": None,
        "state": 1,
        "step": 0,
        "due_at": None,
        "last_review": None,
    }
    operations = [
        _op(day=day0, rating=3, stage=0, has_passed=False, due=day0, fsrs=empty_fsrs),
        _op(day=day1, rating=2, stage=1, has_passed=True, due=day1),
        _op(day=day1, rating=3, stage=0, has_passed=True, due=day1, hard_on=day1.isoformat()),
    ]
    replay = replay_history(operations, unit_id="unit-early")
    assert replay.due_date == day1 + timedelta(days=1)
    assert replay.stage_index == 1
    assert replay.has_passed is True
