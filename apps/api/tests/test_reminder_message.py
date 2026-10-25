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


def test_idle_always_leads_with_how_long_you_stopped() -> None:
    first = compose(
        KIND_IDLE, BASE, snapshot(), {"idle_minutes": BASE.idle_after_minutes + 5}
    )
    # 第一次也要说停了多久，不能把最关键的数字藏到第二次提醒里。
    assert first.title == "已经 1 小时没动了"
    assert "回来评 3 张" in first.body
    later = compose(KIND_IDLE, BASE, snapshot(), {"idle_minutes": 185})
    assert later.title == "已经 3 小时没动了"


def test_idle_reports_the_accumulated_stall_of_the_day() -> None:
    message = compose(
        KIND_IDLE,
        BASE,
        snapshot(
            oldest_overdue_days=0,
            average_retention=None,
            lowest_retention=None,
            elapsed_hours_today=14,
            active_hours_today=2,
        ),
        {"idle_minutes": 185},
    )
    assert message.title == "已经 3 小时没动了"
    assert "今天累计停了 12 小时" in message.body


def test_ready_names_the_new_batch() -> None:
    message = compose(KIND_READY, BASE, snapshot(), {"new_ready": 8, "ready_total": 88})
    assert message.title == "8 张新到期"
    assert "88" in message.body


def test_new_kinds_never_break_in_vague_mode() -> None:
    vague = ReminderSettings(enabled=True, bark_key="k", content_mode="vague")
    for kind in (KIND_MORNING, KIND_EVENING, KIND_READY, KIND_IDLE, KIND_HOURLY):
        message = compose(kind, vague, snapshot(), {"hour": 10, "new_ready": 8})
        assert message.title and message.body


# --- 紧迫感：时间信号 -------------------------------------------------------


def test_morning_leads_with_the_oldest_overdue_unit() -> None:
    message = compose(
        KIND_MORNING,
        BASE,
        snapshot(due_count=47, oldest_overdue_days=5, completed_yesterday=60),
    )
    assert "最久一张逾期 5 天" in message.body
    # 时间在前，昨日成绩在后。
    assert message.body.index("逾期") < message.body.index("昨天")


def test_morning_has_no_overdue_clause_on_a_clean_day() -> None:
    message = compose(KIND_MORNING, BASE, snapshot(oldest_overdue_days=0))
    assert "逾期" not in message.body


def test_evening_pairs_the_deadline_with_the_worst_debt() -> None:
    message = compose(
        KIND_EVENING,
        BASE,
        snapshot(due_count=47, oldest_overdue_days=3, hours_left_today=1.5),
        since_last_minutes=9 * 60 + 20,
    )
    assert message.title == "今天还有 47 张没复习"
    # 正文只放两条：一个是期限，一个是最重的欠账。
    assert message.body == "今天只剩 1 小时 · 最久一张逾期 3 天"


def test_evening_falls_back_to_elapsed_time_on_a_clean_backlog() -> None:
    message = compose(
        KIND_EVENING,
        BASE,
        snapshot(due_count=47, oldest_overdue_days=0, average_retention=None),
        since_last_minutes=9 * 60 + 20,
    )
    assert "距上次复习 9 小时" in message.body


def test_hourly_calls_out_a_dead_hour_with_elapsed_time() -> None:
    message = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_today=86, completed_last_hour=0, completed_yesterday=200),
        {"hour": 15},
        since_last_minutes=125,
    )
    assert "距上次复习 2 小时" in message.body


def test_hourly_stays_positive_when_you_are_working() -> None:
    message = compose(
        KIND_HOURLY,
        BASE,
        snapshot(completed_today=86, completed_last_hour=42, completed_yesterday=200),
        {"hour": 15},
        since_last_minutes=2,
    )
    assert "距上次复习" not in message.body


def test_ready_and_idle_carry_the_backlog_age() -> None:
    ready = compose(
        KIND_READY,
        BASE,
        snapshot(oldest_overdue_days=4),
        {"new_ready": 8, "ready_total": 88},
    )
    assert "最久一张逾期 4 天" in ready.body
    idle = compose(
        KIND_IDLE,
        BASE,
        snapshot(oldest_overdue_days=4),
        {"idle_minutes": 200},
        since_last_minutes=200,
    )
    assert "最久一张逾期 4 天" in idle.body


def test_vague_mode_still_hides_every_count_and_age() -> None:
    vague = ReminderSettings(enabled=True, bark_key="k", content_mode="vague")
    for kind in (KIND_MORNING, KIND_EVENING, KIND_READY, KIND_IDLE, KIND_HOURLY):
        message = compose(
            kind,
            vague,
            snapshot(oldest_overdue_days=9),
            {"hour": 15, "new_ready": 8, "idle_minutes": 200},
            since_last_minutes=200,
        )
        assert "逾期" not in message.body
        assert "距上次复习" not in message.body


def test_duration_switches_to_days_after_a_full_day() -> None:
    message = compose(
        KIND_IDLE,
        BASE,
        snapshot(),
        {"idle_minutes": 26 * 60},
        since_last_minutes=26 * 60,
    )
    assert "已经 1 天没动了" in message.title


def test_no_notification_carries_more_than_two_information_blocks() -> None:
    """锁屏上超过两段就是噪音：每一类都必须能压到两段以内。"""
    rich = snapshot(
        due_count=68,
        oldest_overdue_days=19,
        average_retention=0.60,
        lowest_retention=0.41,
        hours_left_today=1.2,
        elapsed_hours_today=15,
        active_hours_today=2,
        streak_days=9,
        completed_yesterday=39,
        completed_last_hour=0,
    )
    for kind in (KIND_MORNING, KIND_EVENING, KIND_READY, KIND_IDLE, KIND_HOURLY):
        message = compose(
            kind,
            BASE,
            rich,
            {"hour": 22, "new_ready": 8, "ready_total": 68, "idle_minutes": 200},
            runtime_done_before=30,
            since_last_minutes=200,
        )
        assert message.body.count(" · ") <= 1, f"{kind}: {message.body}"


def test_retention_is_skipped_while_it_is_still_high() -> None:
    message = compose(
        KIND_MORNING,
        BASE,
        snapshot(oldest_overdue_days=0, average_retention=0.93, completed_yesterday=0),
    )
    assert "记忆" not in message.body


def test_time_left_only_appears_when_the_day_is_actually_ending() -> None:
    midday = compose(
        KIND_EVENING, BASE, snapshot(hours_left_today=11, oldest_overdue_days=0),
        since_last_minutes=0,
    )
    assert "只剩" not in midday.body
    evening = compose(
        KIND_EVENING, BASE, snapshot(hours_left_today=1.4, oldest_overdue_days=0),
        since_last_minutes=0,
    )
    assert "今天只剩 1 小时" in evening.body
