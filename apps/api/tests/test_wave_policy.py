"""Unit tests for palace wave safety-window policy."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from memory_anki.modules.memory.application.wave_policy import (
    AggregationPolicy,
    WaveCandidate,
    interval_days,
    is_formal_queue_eligible,
    pick_adsorb_wave,
    reinforcement_delay_minutes,
    safety_window_bounds,
)


def test_safety_window_is_symmetric_with_day_caps() -> None:
    """对称容忍窗：长间隔时提前/推后都封顶在 max_pull/push_days（默认 2 天）。"""
    earliest, latest = safety_window_bounds(anchor=date(2026, 7, 22), interval_days_value=100)
    assert earliest == date(2026, 7, 20)
    assert latest == date(2026, 7, 24)


def test_safety_window_scales_with_short_interval() -> None:
    """短间隔按 max_shift_ratio（15%）缩窗：5 天间隔 → 双向 0 天（floor）。"""
    earliest, latest = safety_window_bounds(anchor=date(2026, 7, 22), interval_days_value=5)
    assert earliest == date(2026, 7, 22)
    assert latest == date(2026, 7, 22)
    # 10 天间隔 → 15% = 1.5 → floor 1 天，双向对称。
    earliest, latest = safety_window_bounds(anchor=date(2026, 7, 22), interval_days_value=10)
    assert earliest == date(2026, 7, 21)
    assert latest == date(2026, 7, 23)


def test_safety_window_honors_custom_policy() -> None:
    policy = AggregationPolicy(max_pull_days=1, max_push_days=3, max_shift_ratio=0.5)
    earliest, latest = safety_window_bounds(
        anchor=date(2026, 7, 22), interval_days_value=100, policy=policy
    )
    assert earliest == date(2026, 7, 21)
    assert latest == date(2026, 7, 25)


def test_pick_adsorb_only_uses_future_scheduled_waves() -> None:
    """吸附只进未来的 SCHEDULED 波次：active/paused/今天的波次不接收新卡。"""
    today = date(2026, 7, 22)
    candidates = [
        WaveCandidate("w-active", date(2026, 7, 23), "active"),
        WaveCandidate("w-today", today, "scheduled"),
        WaveCandidate("w-future", date(2026, 7, 23), "scheduled"),
    ]
    picked = pick_adsorb_wave(
        raw_due_local=date(2026, 7, 23),
        interval_days_value=30,
        candidates=candidates,
        stability_days=20.0,
        desired_retention=0.9,
        last_review_at=datetime(2026, 6, 22),
        today=today,
    )
    assert picked is not None
    assert picked.wave_id == "w-future"


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
    # Batch restudy: weak ratings are immediately available (delay 0).
    assert reinforcement_delay_minutes(1, again_minutes=20, hard_minutes=60) == 0
    assert reinforcement_delay_minutes(2, again_minutes=20, hard_minutes=60) == 0
    assert reinforcement_delay_minutes(3, again_minutes=20, hard_minutes=60) is None
    assert reinforcement_delay_minutes(1) == 0


def test_formal_queue_eligibility() -> None:
    assert is_formal_queue_eligible("manual", has_memory=True) is True
    # First-learn: never-reviewed nodes enter the formal queue immediately.
    assert is_formal_queue_eligible("uninitialized", has_memory=False) is True
    assert is_formal_queue_eligible("manual", has_memory=False) is True
    assert is_formal_queue_eligible("content_changed", has_memory=True) is False
    assert is_formal_queue_eligible("content_changed", has_memory=False) is False
    assert is_formal_queue_eligible("reinforcement", has_memory=True) is False
    assert is_formal_queue_eligible("uninitialized", has_memory=True) is False


def test_interval_days_minimum() -> None:
    now = datetime(2026, 7, 22, 12, 0, 0)
    assert interval_days(now, now) > 0
    assert interval_days(None, now + timedelta(days=3)) >= 1.0 / 1440.0
