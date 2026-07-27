"""Unit tests for palace wave safety-window policy."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from memory_anki.modules.memory.application.wave_policy import (
    SCHEDULE_CONSOLIDATE,
    AggregationPolicy,
    WaveCandidate,
    interval_days,
    is_formal_queue_eligible,
    pick_adsorb_wave,
    reinforcement_delay_minutes,
    safety_window_bounds,
    unit_day_offset,
    unit_fuzz_spread_days,
)


def test_safety_window_is_asymmetric_push_wider_than_pull() -> None:
    """提前昂贵（20%）、推后便宜（40%）——窗口必须非对称。"""
    anchor = date(2026, 7, 22)
    earliest, latest = safety_window_bounds(anchor=anchor, interval_days_value=30)
    assert earliest == anchor - timedelta(days=6)  # 30 × 0.20
    assert latest == anchor + timedelta(days=12)  # 30 × 0.40
    assert (latest - anchor) > (anchor - earliest)


def test_short_interval_window_never_collapses_to_zero() -> None:
    """旧实现的致命缺陷：floor(6 × 0.15) = 0 → 6 天间隔的卡永远无法合并。"""
    anchor = date(2026, 7, 22)
    earliest, latest = safety_window_bounds(anchor=anchor, interval_days_value=6)
    assert earliest == anchor - timedelta(days=1)  # min_window_days 兜底
    assert latest == anchor + timedelta(days=2)  # floor(6 × 0.40)
    # 极短间隔同样保底 1 天，不再是零宽度。
    earliest, latest = safety_window_bounds(anchor=anchor, interval_days_value=2)
    assert earliest == anchor - timedelta(days=1)
    assert latest == anchor + timedelta(days=1)


def test_long_interval_window_scales_instead_of_locking_at_two_days() -> None:
    """90 天间隔不再被 max_*_days=2 锁死在 2.2%。"""
    anchor = date(2026, 7, 22)
    earliest, latest = safety_window_bounds(anchor=anchor, interval_days_value=90)
    assert earliest == anchor - timedelta(days=18)
    assert latest == anchor + timedelta(days=30)  # 绝对兜底 max_push_days=30


def test_safety_window_honors_custom_policy() -> None:
    policy = AggregationPolicy(max_pull_ratio=0.1, max_push_ratio=0.5, max_pull_days=1)
    earliest, latest = safety_window_bounds(
        anchor=date(2026, 7, 22), interval_days_value=100, policy=policy
    )
    assert earliest == date(2026, 7, 21)  # cap 1 天
    assert latest == date(2026, 7, 22) + timedelta(days=30)  # 50 被 max_push_days 兜底


def test_twenty_card_unit_converges_to_two_waves() -> None:
    """6–15 天的一批卡在新窗口下应能聚成 2 簇（贪心质心的可行性验证）。

    这条断言的是"窗口够宽"这个前提；实际聚类在 aggregation.compute_unit_aggregation。
    """
    anchor_days = [6, 7, 8, 9, 11, 13, 15]
    base = date(2026, 7, 22)
    windows = {
        days: safety_window_bounds(
            anchor=base + timedelta(days=days), interval_days_value=days
        )
        for days in anchor_days
    }
    # Day 8 能覆盖 6/7/8；Day 12 能覆盖 9/11/13/15。
    day8 = base + timedelta(days=8)
    day12 = base + timedelta(days=12)
    for days in (6, 7, 8):
        lo, hi = windows[days]
        assert lo <= day8 <= hi, f"{days} 天间隔的卡够不到 Day 8"
    for days in (9, 11, 13, 15):
        lo, hi = windows[days]
        assert lo <= day12 <= hi, f"{days} 天间隔的卡够不到 Day 12"
    # 6 天与 15 天不可能合并——这是 FSRS 固有几何，不是参数问题。
    lo6, hi6 = windows[6]
    lo15, hi15 = windows[15]
    assert hi6 < lo15


def test_unit_day_offset_is_deterministic_and_clamped() -> None:
    kwargs = {
        "palace_id": 7,
        "unit_root_uid": "u-root",
        "anchor": date(2026, 7, 22),
        "spread_days": 2,
    }
    first = unit_day_offset(**kwargs, lo=-2, hi=2)
    assert first == unit_day_offset(**kwargs, lo=-2, hi=2)  # 幂等
    assert -2 <= first <= 2
    # 可行区间收窄时钳制，不重掷。
    assert unit_day_offset(**kwargs, lo=0, hi=0) == 0
    assert -1 <= unit_day_offset(**kwargs, lo=-1, hi=1) <= 1
    # 不同单元/不同质心得到不同偏移（不产生系统性偏置）。
    other_unit = unit_day_offset(
        palace_id=7, unit_root_uid="u-other", anchor=date(2026, 7, 22),
        spread_days=2, lo=-2, hi=2,
    )
    other_anchor = unit_day_offset(
        palace_id=7, unit_root_uid="u-root", anchor=date(2026, 8, 30),
        spread_days=2, lo=-2, hi=2,
    )
    assert len({first, other_unit, other_anchor}) >= 2
    # spread 0（短间隔单元）不偏移。
    assert unit_day_offset(**{**kwargs, "spread_days": 0}, lo=-2, hi=2) == 0


def test_unit_fuzz_spread_tiers() -> None:
    assert unit_fuzz_spread_days(3) == 0
    assert unit_fuzz_spread_days(10) == 1
    assert unit_fuzz_spread_days(30) == 2
    assert unit_fuzz_spread_days(120) == 3


def test_consolidate_cards_leave_the_formal_queue() -> None:
    """巩固卡不进宫殿队列/冻结集——一张短间隔卡不该唤醒整个宫殿。"""
    assert is_formal_queue_eligible(SCHEDULE_CONSOLIDATE, has_memory=True) is False
    assert is_formal_queue_eligible(SCHEDULE_CONSOLIDATE, has_memory=False) is False


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
