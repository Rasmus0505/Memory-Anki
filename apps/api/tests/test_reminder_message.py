"""通知文案：成就感优先、隐私模式和三类高频提醒的语气。"""

from __future__ import annotations

from memory_anki.modules.reminders.application.reminder_message import compose
from memory_anki.modules.reminders.domain.schemas import (
    KIND_EVENING,
    KIND_HOURLY,
    KIND_IDLE,
    KIND_MORNING,
    KIND_READY,
    DueSnapshot,
    ReminderSettings,
)

BASE = ReminderSettings(enabled=True, bark_key="k")


def snapshot(**overrides) -> DueSnapshot:
    values = {
        "due_count": 94,
        "ready_now_count": 80,
        "completed_today": 86,
        "completed_yesterday": 60,
        "completed_last_hour": 42,
        "streak_days": 0,
    }
    values.update(overrides)
    return DueSnapshot(**values)


def test_hourly_leads_with_progress_not_remaining() -> None:
    message = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_yesterday=200),
        {"hour": 10},
    )
    assert message.title == "今天 86 / 180"
    assert "这一小时 42 张" in message.body
    assert message.body.index("42") < message.body.index("还剩")


def test_hourly_celebrates_a_milestone_only_when_crossing() -> None:
    crossing = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_today=120, completed_yesterday=60),
        {"hour": 11},
        runtime_done_before=98,
    )
    assert crossing.title == "今天第 120 张"
    repeat = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_today=120, completed_yesterday=60),
        {"hour": 12},
        runtime_done_before=120,
    )
    assert repeat.title != "今天第 120 张"


def test_hourly_marks_the_moment_you_pass_yesterday_once() -> None:
    first = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_today=86, completed_yesterday=80),
        {"hour": 15},
        runtime_done_before=70,
    )
    assert first.title == "超过昨天了"
    again = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_today=86, completed_yesterday=80),
        {"hour": 16},
        runtime_done_before=86,
    )
    assert again.title != "超过昨天了"


def test_hourly_shows_the_streak_when_it_is_worth_mentioning() -> None:
    message = compose(
        KIND_HOURLY,
        BASE,
        snapshot(streak_days=12, completed_today=86, completed_yesterday=200),
        {"hour": 13},
    )
    assert message.title == "连续第 12 天"
    assert "今天累计 86 张" in message.body


def test_hourly_says_when_the_queue_is_empty() -> None:
    message = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_today=120, due_count=0, streak_days=12),
        {"hour": 20},
    )
    assert message.title == "今天的队列清完了"
    assert "连续第 12 天" in message.body


def test_hourly_turns_into_a_wrap_up_before_quiet_hours() -> None:
    message = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_today=86, streak_days=4),
        {"hour": 23},
    )
    assert message.title == "今天收工"


def test_quiet_hour_midnight_makes_the_wrap_up_the_23rd() -> None:
    # 免打扰 0–8 点：23:00 是当天最后一条。
    assert (BASE.quiet_start_hour - 1) % 24 == 23


def test_vague_mode_keeps_the_streak_but_hides_the_queue() -> None:
    vague = ReminderSettings(enabled=True, bark_key="k", content_mode="vague")
    message = compose(KIND_HOURLY, vague, snapshot(streak_days=9), {"hour": 10})
    assert message.title == "整点小结"
    assert "86 张" in message.body
    assert "连续第 9 天" in message.body
    assert "还剩" not in message.body


def test_idle_first_nudge_is_gentle_and_actionable() -> None:
    first = compose(
        KIND_IDLE, BASE, snapshot(), {"idle_minutes": BASE.idle_after_minutes + 5}
    )
    assert first.title == "还在吗？"
    assert "回来评 3 张" in first.body
    later = compose(KIND_IDLE, BASE, snapshot(), {"idle_minutes": 185})
    assert later.title == "已经 3 小时没动了"


def test_ready_names_the_new_batch() -> None:
    message = compose(KIND_READY, BASE, snapshot(), {"new_ready": 8, "ready_total": 88})
    assert message.title == "8 张新到期"
    assert "88" in message.body


def test_new_kinds_never_break_in_vague_mode() -> None:
    vague = ReminderSettings(enabled=True, bark_key="k", content_mode="vague")
    for kind in (KIND_MORNING, KIND_EVENING, KIND_READY, KIND_IDLE, KIND_HOURLY):
        message = compose(kind, vague, snapshot(), {"hour": 10, "new_ready": 8})
        assert message.title and message.body
