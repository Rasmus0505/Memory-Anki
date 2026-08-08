"""Ladder transition rules: hard passes, proportional lapses, spread, invariants.

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


def _gap(stage_index: int, rating: int, *, has_passed: bool, prior_failure: bool = False) -> int:
    result = rate_unit(
        stage_index=stage_index,
        has_passed=has_passed,
        rating=rating,
        had_failure_in_encounter=prior_failure,
        today=TODAY,
    )
    return (result.due_date - TODAY).days


def test_ladder_shape_is_unchanged():
    """The toolbar histogram and `ladder` payload depend on this exact shape."""
    assert INTERVAL_DAYS == (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)


def test_hard_on_a_mature_unit_passes_with_a_shorter_real_interval():
    """困难 used to mean due-today + not-passed, so it could never advance time."""
    result = rate_unit(
        stage_index=9,
        has_passed=True,
        rating=2,
        had_failure_in_encounter=False,
        today=TODAY,
    )
    assert result.passed is True
    assert result.retry_after_cards == 0
    assert result.stage_index == 8
    assert (result.due_date - TODAY).days == INTERVAL_DAYS[8]

    # Shorter than 记得 at the same position, but still a real forward booking.
    assert _gap(9, 2, has_passed=True) < _gap(9, 3, has_passed=True)
    assert _gap(9, 2, has_passed=True) > 0


def test_hard_is_monotonic_below_remember_across_the_whole_ladder():
    for stage in range(1, len(INTERVAL_DAYS)):
        hard = _gap(stage, 2, has_passed=True)
        remember = _gap(stage, 3, has_passed=True)
        easy = _gap(stage, 4, has_passed=True)
        assert 0 < hard <= remember <= easy, f"stage {stage}"


def test_hard_on_a_never_passed_unit_still_retries_same_day():
    """First-learning behaviour is unchanged: no interval until a real pass."""
    result = rate_unit(
        stage_index=0,
        has_passed=False,
        rating=2,
        had_failure_in_encounter=False,
        today=TODAY,
    )
    assert (result.stage_index, result.due_date, result.passed) == (0, TODAY, False)
    assert result.retry_after_cards == 3


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
