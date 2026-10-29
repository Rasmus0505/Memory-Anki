"""FSRS shadow adapter: product rules must survive the algorithm swap."""

from datetime import UTC, date, datetime, timedelta

from fsrs import State

from memory_anki.core.exam_horizon import resolve_sprint_horizon
from memory_anki.modules.memory.application.unit_fsrs_adapter import (
    FsrsUnitState,
    build_shadow_scheduler,
    rate_unit_with_fsrs,
)

TODAY = date(2026, 10, 24)
RATED_AT = datetime(2026, 10, 24, 1, 0, tzinfo=UTC)  # 09:00 Beijing
SCHEDULER = build_shadow_scheduler()


def _mature_state(*, stability: float = 10.0) -> FsrsUnitState:
    return FsrsUnitState(
        stability=stability,
        difficulty=5.0,
        fsrs_state=int(State.Review),
        step=None,
        due_at=datetime(2026, 10, 24, 1, 0),
        last_review=datetime(2026, 10, 14, 1, 0),
    )


def _rate(
    *,
    current: FsrsUnitState | None = None,
    rating: int,
    has_passed: bool = True,
    locked: bool = False,
    locked_due: date | None = None,
    fuzz_key: str | None = None,
    horizon=None,
    early_step: int | None = 1,
    previous_interval_days: int | None = 10,
    step_pending: bool = False,
    lapse_original_days: int | None = None,
    lapse_started_on: date | None = None,
    today: date = TODAY,
):
    return rate_unit_with_fsrs(
        current=current or _mature_state(),
        has_passed=has_passed,
        rating=rating,
        today=today,
        rated_at=RATED_AT,
        schedule_locked=locked,
        locked_due_date=locked_due,
        fuzz_key=fuzz_key,
        horizon=horizon,
        scheduler=SCHEDULER,
        early_step=early_step,
        previous_interval_days=previous_interval_days,
        step_pending=step_pending,
        lapse_original_days=lapse_original_days,
        lapse_started_on=lapse_started_on,
    )


def test_a_pass_never_lands_today():
    """The ladder's MIN_PASSED_STAGE rule, now on the FSRS side."""
    for rating in (3, 4):
        result = _rate(current=FsrsUnitState.empty(), rating=rating, has_passed=False)
        assert result.passed is True
        assert result.due_date >= TODAY + timedelta(days=1)
        assert result.interval_days >= 1


def test_forgetting_retries_today_and_records_fsrs_again():
    before = _mature_state()
    result = _rate(current=before, rating=1)

    assert result.passed is False
    assert result.due_date == TODAY
    assert result.retry_after_cards == 3
    assert result.schedule_changed is True
    assert result.fsrs_applied is True
    assert result.state.last_review is not None
    assert result.state.stability != before.stability


def test_hard_is_a_pass_that_never_lengthens_the_interval():
    result = _rate(rating=2, previous_interval_days=10)

    assert result.passed is True
    assert result.due_date <= TODAY + timedelta(days=10)
    assert result.due_date >= TODAY + timedelta(days=8)
    assert result.retry_after_cards == 0
    assert result.fsrs_applied is True
    assert result.guardrail_applied is True


def test_hard_on_a_retry_day_falls_back_to_one_day():
    result = _rate(rating=2, previous_interval_days=0)

    assert result.passed is True
    assert result.due_date == TODAY + timedelta(days=1)


def test_locked_pass_records_no_schedule_change():
    booked = TODAY + timedelta(days=20)
    before = _mature_state()
    result = _rate(
        current=before,
        rating=4,
        locked=True,
        locked_due=booked,
    )

    assert result.passed is True
    assert result.schedule_changed is False
    assert result.due_date == booked
    assert result.fsrs_applied is False
    assert result.state == before


def test_locked_forget_still_lapses():
    """A lapse is honest evidence even when the card was served early."""
    before = _mature_state()
    result = _rate(
        current=before,
        rating=1,
        locked=True,
        locked_due=TODAY + timedelta(days=20),
    )

    assert result.passed is False
    assert result.due_date == TODAY
    assert result.schedule_changed is True
    assert result.fsrs_applied is True
    assert result.state != before


def test_sprint_horizon_bounds_a_long_fsrs_interval():
    horizon = resolve_sprint_horizon(
        exam_date="2026-11-23",
        sprint_mode=True,
        today=TODAY,
    )
    assert horizon is not None
    result = _rate(
        current=_mature_state(stability=300.0),
        rating=3,
        fuzz_key="unit-horizon",
        horizon=horizon,
        previous_interval_days=300,
    )

    assert result.passed is True
    assert result.due_date <= horizon.last_due
    assert result.horizon_applied is True


def test_deterministic_fuzz_scatters_a_cohort_within_bounds():
    results = {
        _rate(
            current=_mature_state(stability=100.0),
            rating=3,
            fuzz_key=f"unit-{index}",
            previous_interval_days=100,
        ).due_date
        for index in range(40)
    }
    assert len(results) > 1

    same_key = [
        _rate(
            current=_mature_state(stability=100.0),
            rating=3,
            fuzz_key="unit-same",
            previous_interval_days=100,
        ).due_date
        for _ in range(3)
    ]
    assert len(set(same_key)) == 1


def test_forgetting_stays_today_even_with_a_horizon():
    horizon = resolve_sprint_horizon(
        exam_date="2026-11-23",
        sprint_mode=True,
        today=TODAY,
    )
    result = _rate(rating=1, horizon=horizon)
    assert result.due_date == TODAY
    assert result.passed is False

    hard = _rate(rating=2, horizon=horizon)
    assert hard.passed is True
    assert hard.due_date > TODAY


def test_shadow_scheduler_is_deterministic_by_default():
    assert SCHEDULER.enable_fuzzing is False
    assert SCHEDULER.desired_retention == 0.9
    assert SCHEDULER.maximum_interval == 365


def test_empty_state_is_distinguishable_from_a_fresh_card():
    """Inheritance and pre-switch rows only carry the legacy projection."""
    assert FsrsUnitState.empty().is_empty() is True
    seeded = FsrsUnitState.from_legacy(
        stage_index=9,
        has_passed=True,
        due_date=TODAY + timedelta(days=30),
    )
    assert seeded.is_empty() is False
    # A never-passed unit is genuinely new, so seeding it stays empty.
    assert (
        FsrsUnitState.from_legacy(stage_index=0, has_passed=False, due_date=TODAY).is_empty()
        is True
    )


def test_legacy_seed_keeps_a_mature_unit_mature():
    """A seed from the top stage must not behave like a first-ever review."""
    seeded = FsrsUnitState.from_legacy(
        stage_index=9,
        has_passed=True,
        due_date=TODAY,
    )
    result = _rate(current=seeded, rating=3, previous_interval_days=365)

    assert result.passed is True
    assert result.interval_days >= 300


def test_anchor_first_pass_books_tomorrow_and_stays_anchored():
    result = _rate(
        current=FsrsUnitState.empty(),
        rating=3,
        has_passed=False,
        early_step=0,
        previous_interval_days=0,
    )

    assert result.passed is True
    assert result.due_date == TODAY + timedelta(days=1)
    assert result.early_step == 0
    assert result.anchor_applied is True


def test_anchor_first_pass_easy_skips_to_three_days():
    result = _rate(
        current=FsrsUnitState.empty(),
        rating=4,
        has_passed=False,
        early_step=0,
        previous_interval_days=0,
    )

    assert result.due_date == TODAY + timedelta(days=3)
    assert result.early_step == 1


def test_anchor_overnight_remember_graduates_with_three_days():
    result = _rate(rating=3, has_passed=True, early_step=0, previous_interval_days=1)

    assert result.due_date == TODAY + timedelta(days=3)
    assert result.early_step == 1


def test_anchor_overnight_easy_graduates_with_five_days():
    result = _rate(rating=4, has_passed=True, early_step=0, previous_interval_days=1)

    assert result.due_date == TODAY + timedelta(days=5)
    assert result.early_step == 1


def test_anchor_overnight_hard_asks_for_one_more_overnight():
    result = _rate(rating=2, has_passed=True, early_step=0, previous_interval_days=1)

    assert result.passed is True
    assert result.due_date == TODAY + timedelta(days=1)
    assert result.early_step == 0


def test_remember_is_capped_at_two_and_a_half_times_below_ten_days():
    result = _rate(
        current=_mature_state(stability=50.0),
        rating=3,
        previous_interval_days=3,
    )

    assert result.interval_days == 7
    assert result.guardrail_applied is True


def test_easy_is_capped_at_three_and_a_half_times_below_ten_days():
    result = _rate(
        current=_mature_state(stability=50.0),
        rating=4,
        previous_interval_days=3,
    )

    assert result.interval_days == 10


def test_the_cap_lifts_from_ten_days():
    result = _rate(
        current=_mature_state(stability=50.0),
        rating=3,
        previous_interval_days=10,
    )

    assert result.interval_days > 25
    assert result.guardrail_applied is False


def test_a_mature_forget_remembers_the_earned_interval():
    result = _rate(rating=1, previous_interval_days=60)

    assert result.due_date == TODAY
    assert result.lapse_original_days == 60
    assert result.lapse_started_on == TODAY


def test_a_young_forget_does_not_enter_lapse_recovery():
    result = _rate(rating=1, previous_interval_days=5)

    assert result.lapse_original_days is None


def test_the_confirmation_after_a_lapse_restores_thirty_percent():
    result = _rate(
        current=_mature_state(stability=2.0),
        rating=3,
        previous_interval_days=1,
        lapse_original_days=60,
        lapse_started_on=TODAY - timedelta(days=1),
    )

    assert result.interval_days == 18
    assert result.lapse_original_days is None
    assert result.lapse_started_on is None
    assert result.guardrail_applied is True


def test_the_confirmation_same_day_does_not_restore_yet():
    result = _rate(
        current=_mature_state(stability=2.0),
        rating=3,
        previous_interval_days=0,
        lapse_original_days=60,
        lapse_started_on=TODAY,
    )

    assert result.lapse_original_days == 60
    assert result.interval_days != 18
