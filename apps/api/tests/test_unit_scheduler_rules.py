"""Ladder transition rules: hard retries, lapses to 忘记 level, spread, invariants.

These pin the scheduling rules (忘记 resets to stage 0; 困难 demotes once per day). The ladder itself (stage count and
nominal intervals) is deliberately unchanged — `unit_ladder_progress` ships
`INTERVAL_DAYS` to the toolbar strip and indexes a histogram by stage.
"""

from datetime import date

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


def test_ladder_shape_is_unchanged():
    """The toolbar histogram and `ladder` payload depend on this exact shape."""
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


def test_forgetting_a_mature_unit_drops_to_the_forgot_level():
    """忘记 always lands on the 忘记 level (stage 0), whatever stage it was at."""
    lapsed = rate_unit(
        stage_index=9,
        has_passed=True,
        rating=1,
        had_failure_in_encounter=False,
        today=TODAY,
    )
    assert lapsed.passed is False
    assert lapsed.due_date == TODAY
    assert lapsed.retry_after_cards == 3
    assert lapsed.stage_index == 0
    assert lapsed.hard_penalty_applied is False

    # Relearning from stage 0 in the same encounter books the first-step interval.
    relearned = rate_unit(
        stage_index=lapsed.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=True,
        today=TODAY,
    )
    assert relearned.stage_index == MIN_PASSED_STAGE
    assert (relearned.due_date - TODAY).days == INTERVAL_DAYS[MIN_PASSED_STAGE] == 1


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


def test_a_pass_never_schedules_zero_days():
    """Root cause of the "passed but still due today" queue residue."""
    violations = []
    for stage in range(len(INTERVAL_DAYS)):
        for has_passed in (True, False):
            for prior_failure in (True, False):
                for rating in (1, 2, 3, 4):
                    result = rate_unit(
                        stage_index=stage,
                        has_passed=has_passed,
                        rating=rating,
                        had_failure_in_encounter=prior_failure,
                        today=TODAY,
                    )
                    if result.passed and (result.due_date - TODAY).days < 1:
                        violations.append((stage, has_passed, prior_failure, rating))
                    if result.passed:
                        assert result.stage_index >= MIN_PASSED_STAGE
    assert violations == []


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

from datetime import timedelta  # noqa: E402

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
