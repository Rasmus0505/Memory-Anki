"""到点判定：用假时钟覆盖时段、免打扰、补发、去重与阈值分支。"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from zoneinfo import ZoneInfo

from memory_anki.core.time import utc_now_naive
from memory_anki.modules.reminders.application.reminder_schedule import (
    candidate_slot,
    evaluate,
    in_quiet_hours,
    next_reminder_at,
    slot_window,
)
from memory_anki.modules.reminders.domain.schemas import (
    KIND_EVENING,
    KIND_MORNING,
    SEND_NOW,
    SKIP_ALREADY_SENT,
    SKIP_ALREADY_STUDIED,
    SKIP_ATTEMPTS_EXHAUSTED,
    SKIP_BELOW_THRESHOLD,
    SKIP_NOTHING_DUE,
    SKIP_RETRY_BACKOFF,
    DeliveryState,
    DueSnapshot,
    ReminderSettings,
)

TZ = ZoneInfo("Asia/Shanghai")


def at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, 25, hour, minute, tzinfo=TZ)


def settings(**overrides) -> ReminderSettings:
    return replace(ReminderSettings(enabled=True, bark_key="key-1234"), **overrides)


def test_candidate_slot_hits_both_windows_and_the_catch_up_tail() -> None:
    active = settings()
    assert candidate_slot(at(8, 29), active) is None
    assert candidate_slot(at(8, 30), active) == KIND_MORNING
    # 补发窗口内（默认到 12:00）开机仍然发早上那条。
    assert candidate_slot(at(11, 59), active) == KIND_MORNING
    assert candidate_slot(at(12, 0), active) is None
    assert candidate_slot(at(20, 30), active) == KIND_EVENING


def test_quiet_window_is_configurable_and_wraps_midnight() -> None:
    assert in_quiet_hours(at(0, 30), settings()) is True
    assert in_quiet_hours(at(7, 59), settings()) is True
    assert in_quiet_hours(at(8, 0), settings()) is False
    # 跨零点：22:00 → 8:00
    night = settings(quiet_start_hour=22, quiet_end_hour=8)
    assert in_quiet_hours(at(23, 0), night) is True
    assert in_quiet_hours(at(6, 0), night) is True
    assert in_quiet_hours(at(12, 0), night) is False
    # 开始等于结束表示不设免打扰。
    assert in_quiet_hours(at(3, 0), settings(quiet_start_hour=5, quiet_end_hour=5)) is False


def test_candidate_slot_respects_the_master_switch_and_quiet_hours() -> None:
    assert candidate_slot(at(8, 30), settings(enabled=False)) is None
    assert candidate_slot(at(8, 30), settings(bark_key="")) is None
    # 把免打扰挪到早上，早上那条就不再触发。
    assert candidate_slot(at(8, 30), settings(quiet_end_hour=10)) is None


def test_slot_window_is_start_plus_catch_up_minutes() -> None:
    start, end = slot_window(at(9, 0), settings(), KIND_MORNING)
    assert start.hour == 8 and start.minute == 30
    assert end.hour == 12 and end.minute == 0


def test_evaluate_sends_morning_when_there_is_work() -> None:
    decision = evaluate(
        KIND_MORNING,
        settings(),
        DueSnapshot(due_count=128, completed_today=0, completed_yesterday=210),
        DeliveryState(),
        utc_now_naive(),
    )
    assert decision.send is True
    assert decision.reason == SEND_NOW


def test_evaluate_never_repeats_a_sent_slot() -> None:
    decision = evaluate(
        KIND_MORNING,
        settings(),
        DueSnapshot(due_count=10),
        DeliveryState(status="sent", attempts=1),
        utc_now_naive(),
    )
    assert decision.reason == SKIP_ALREADY_SENT


def test_evaluate_stops_after_three_failed_attempts() -> None:
    decision = evaluate(
        KIND_MORNING,
        settings(),
        DueSnapshot(due_count=10),
        DeliveryState(status="failed", attempts=3),
        utc_now_naive(),
    )
    assert decision.reason == SKIP_ATTEMPTS_EXHAUSTED


def test_evaluate_waits_between_retries() -> None:
    now = utc_now_naive()
    decision = evaluate(
        KIND_MORNING,
        settings(),
        DueSnapshot(due_count=10),
        DeliveryState(status="failed", attempts=1, last_attempt_at=now),
        now,
    )
    assert decision.reason == SKIP_RETRY_BACKOFF


def test_evaluate_skips_an_empty_queue_and_a_below_threshold_day() -> None:
    empty = evaluate(
        KIND_MORNING, settings(), DueSnapshot(due_count=0), DeliveryState(), utc_now_naive()
    )
    assert empty.reason == SKIP_NOTHING_DUE
    below = evaluate(
        KIND_MORNING,
        settings(due_threshold=30),
        DueSnapshot(due_count=12),
        DeliveryState(),
        utc_now_naive(),
    )
    assert below.reason == SKIP_BELOW_THRESHOLD


def test_evening_is_silent_once_anything_was_completed() -> None:
    decision = evaluate(
        KIND_EVENING,
        settings(),
        DueSnapshot(due_count=50, completed_today=3),
        DeliveryState(),
        utc_now_naive(),
    )
    assert decision.reason == SKIP_ALREADY_STUDIED
    sends = evaluate(
        KIND_EVENING,
        settings(),
        DueSnapshot(due_count=50, completed_today=0),
        DeliveryState(),
        utc_now_naive(),
    )
    assert sends.send is True


def test_next_reminder_at_moves_to_tomorrow_after_the_last_slot() -> None:
    upcoming = next_reminder_at(at(9, 0), settings())
    assert upcoming is not None
    assert upcoming[1] == KIND_EVENING
    assert upcoming[0].hour == 20
    tomorrow = next_reminder_at(at(22, 0), settings())
    assert tomorrow is not None
    assert tomorrow[0].day == 26 and tomorrow[0].hour == 8
    assert next_reminder_at(at(9, 0), settings(enabled=False)) is None
