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
    hard_today: bool = False,
    fuzz_key: str | None = None,
    horizon=None,
):
    return rate_unit_with_fsrs(
        current=current or _mature_state(),
        has_passed=has_passed,
        rating=rating,
        today=TODAY,
        rated_at=RATED_AT,
        schedule_locked=locked,
        locked_due_date=locked_due,
        hard_penalized_today=hard_today,
        fuzz_key=fuzz_key,
        horizon=horizon,
        scheduler=SCHEDULER,
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


def test_hard_retries_today_and_demotes_only_once():
    first = _rate(rating=2)
    assert first.passed is False
    assert first.due_date == TODAY
    assert first.hard_penalty_applied is True
    assert first.state.stability is not None

    second = _rate(
        current=first.state,
        rating=2,
        hard_today=True,
    )
    assert second.due_date == TODAY
    assert second.hard_penalty_applied is False
    assert second.fsrs_applied is False
    assert second.state == first.state


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
        ).due_date
        for index in range(40)
    }
    assert len(results) > 1

    same_key = [
        _rate(
            current=_mature_state(stability=100.0),
            rating=3,
            fuzz_key="unit-same",
        ).due_date
        for _ in range(3)
    ]
    assert len(set(same_key)) == 1


def test_failed_grades_stay_today_even_with_a_horizon():
    horizon = resolve_sprint_horizon(
        exam_date="2026-11-23",
        sprint_mode=True,
        today=TODAY,
    )
    for rating in (1, 2):
        result = _rate(rating=rating, horizon=horizon)
        assert result.due_date == TODAY
        assert result.passed is False


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
    result = _rate(current=seeded, rating=3)

    assert result.passed is True
    assert result.interval_days >= 300
