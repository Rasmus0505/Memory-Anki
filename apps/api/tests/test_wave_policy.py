"""Unit tests for palace wave safety-window policy."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from memory_anki.modules.reviews.application.wave_policy import (
    WaveCandidate,
    interval_days,
    is_formal_queue_eligible,
    pick_adsorb_wave,
    reinforcement_delay_minutes,
    safety_window_bounds,
)


def test_safety_window_bounds_cap_at_three_and_one_days() -> None:
    earliest, latest = safety_window_bounds(anchor=date(2026, 7, 22), interval_days_value=100)
    assert earliest == date(2026, 7, 19)  # max 3 days earlier
    assert latest == date(2026, 7, 23)  # max 1 day later


def test_safety_window_scales_with_short_interval() -> None:
    earliest, latest = safety_window_bounds(anchor=date(2026, 7, 22), interval_days_value=5)
    # 20% of 5 = 1 day pull; 10% of 5 = 0 days push (floor)
    assert earliest == date(2026, 7, 21)
    assert latest == date(2026, 7, 22)


def test_pick_adsorb_prefers_closer_earlier_on_tie() -> None:
    candidates = [
        WaveCandidate("w-later", date(2026, 7, 23), "scheduled"),
        WaveCandidate("w-earlier", date(2026, 7, 21), "scheduled"),
        WaveCandidate("w-far", date(2026, 8, 1), "scheduled"),
    ]
    picked = pick_adsorb_wave(
        raw_due_local=date(2026, 7, 22),
        interval_days_value=30,
        candidates=candidates,
        stability_days=20.0,
        desired_retention=0.9,
        last_review_at=datetime(2026, 6, 22),
    )
    assert picked is not None
    # both earlier and later are distance 1; prefer earlier
    assert picked.wave_id == "w-earlier"


def test_pick_adsorb_returns_none_outside_window() -> None:
    candidates = [WaveCandidate("w-far", date(2026, 8, 15), "scheduled")]
    picked = pick_adsorb_wave(
        raw_due_local=date(2026, 7, 22),
        interval_days_value=10,
        candidates=candidates,
        stability_days=10.0,
        desired_retention=0.9,
        last_review_at=datetime(2026, 7, 12),
    )
    assert picked is None


def test_reinforcement_delays() -> None:
    assert reinforcement_delay_minutes(1, again_minutes=20, hard_minutes=60) == 20
    assert reinforcement_delay_minutes(2, again_minutes=20, hard_minutes=60) == 60
    assert reinforcement_delay_minutes(3, again_minutes=20, hard_minutes=60) is None


def test_formal_queue_eligibility() -> None:
    assert is_formal_queue_eligible("manual", has_memory=True) is True
    assert is_formal_queue_eligible("uninitialized", has_memory=False) is False
    assert is_formal_queue_eligible("content_changed", has_memory=True) is False
    assert is_formal_queue_eligible("reinforcement", has_memory=True) is False


def test_interval_days_minimum() -> None:
    now = datetime(2026, 7, 22, 12, 0, 0)
    assert interval_days(now, now) > 0
    assert interval_days(None, now + timedelta(days=3)) >= 1.0 / 1440.0
