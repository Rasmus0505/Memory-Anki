"""Ladder transition rules: hard retries, proportional lapses, spread, invariants.

These pin the 2026-08 scheduling fixes. The ladder itself (stage count and
nominal intervals) is deliberately unchanged — `unit_ladder_progress` ships
`INTERVAL_DAYS` to the toolbar strip and indexes a histogram by stage.
"""

from datetime import date

from memory_anki.modules.memory.application.unit_scheduler import (
    FUZZ_MIN_INTERVAL_DAYS,
    FUZZ_RATIO,
    INTERVAL_DAYS,
    MIN_PASSED_STAGE,
    lapse_stage,
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


def test_forgetting_a_mature_unit_keeps_proportional_credit():
    """忘记 used to hard-reset to stage 0, costing ~475 days of rebuilding."""
    assert lapse_stage(9, True) == 4
    assert lapse_stage(5, True) == 2
    assert lapse_stage(1, True) == 0

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
    assert lapsed.stage_index == 4

    # Relearning in the same encounter books a proportional interval, not 1 day.
    relearned = rate_unit(
        stage_index=lapsed.stage_index,
        has_passed=True,
        rating=3,
        had_failure_in_encounter=True,
        today=TODAY,
    )
    assert (relearned.due_date - TODAY).days == INTERVAL_DAYS[4] == 14


def test_forgetting_a_never_passed_unit_returns_to_first_learning():
    assert lapse_stage(0, False) == 0
    assert lapse_stage(4, False) == 0


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
    assert result.stage_index == 2


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


def test_fuzz_never_produces_a_non_positive_interval():
    for stage in range(1, len(INTERVAL_DAYS)):
        for index in range(200):
            assert scheduled_interval_days(stage, fuzz_key=f"u{index}") >= 1
