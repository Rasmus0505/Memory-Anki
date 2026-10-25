"""提醒循环：裁决、去重、闲置升级、就绪阈值与每日上限。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from memory_anki.modules.reminders.application import presence, reminder_loop
from memory_anki.modules.reminders.application.activity_probe import ActivitySnapshot
from memory_anki.modules.reminders.application.reminder_settings import update_settings
from memory_anki.modules.reminders.domain.schemas import DueSnapshot
from memory_anki.modules.reminders.infrastructure.bark_gateway import BarkResult

TZ = ZoneInfo("Asia/Shanghai")


class _Sender:
    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.calls: list[dict] = []

    def __call__(self, key, title, body, **kwargs):
        self.calls.append({"key": key, "title": title, "body": body, **kwargs})
        return BarkResult(self.ok, 200, "" if self.ok else "boom")


class World:
    """一次 tick 能看到的外部世界：快照 + 最近动作。"""

    def __init__(self) -> None:
        self.snapshot = DueSnapshot(
            due_count=42,
            ready_now_count=42,
            completed_today=0,
            completed_yesterday=7,
            completed_last_hour=5,
            streak_days=0,
        )
        self.activity = ActivitySnapshot(
            last_activity_at=None, started_today=False
        )

    def worked_until(self, moment: datetime) -> None:
        utc = moment.astimezone(UTC).replace(tzinfo=None)
        self.activity = ActivitySnapshot(last_activity_at=utc, started_today=True)


@pytest.fixture(autouse=True)
def _clean_presence():
    """心跳是进程级全局状态：不清掉，前面模块打的点会让闲置测试永远不触发。"""
    presence.reset()
    yield
    presence.reset()


@pytest.fixture()
def world(session_factory, monkeypatch) -> World:
    def fake_get_session():
        return session_factory()

    monkeypatch.setattr(reminder_loop, "get_session", fake_get_session)
    state = World()
    monkeypatch.setattr(reminder_loop, "read_due_snapshot", lambda *a, **k: state.snapshot)
    monkeypatch.setattr(reminder_loop, "read_activity", lambda *a, **k: state.activity)
    monkeypatch.setattr(reminder_loop, "last_ui_seen", lambda: None)
    return state


def configure(session_factory, **overrides) -> None:
    session = session_factory()
    update_settings(session, {"enabled": True, "bark_key": "abcdefgh", **overrides})
    session.commit()
    session.close()


def at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, 25, hour, minute, tzinfo=TZ)


def test_morning_slot_is_sent_once_per_study_day(world, session_factory) -> None:
    configure(session_factory)
    sender = _Sender()
    first = reminder_loop.run_reminder_tick(at(8, 30), sender)
    assert first["sent"] is True and first["kind"] == "morning"
    assert len(sender.calls) == 1

    again = reminder_loop.run_reminder_tick(at(9, 5), sender)
    assert again["sent"] is False
    assert again["reason"] == "already_sent"
    assert len(sender.calls) == 1


def test_a_new_study_day_can_send_again(world, session_factory) -> None:
    configure(session_factory)
    sender = _Sender()
    reminder_loop.run_reminder_tick(at(8, 30), sender)
    next_day = reminder_loop.run_reminder_tick(
        datetime(2026, 10, 26, 8, 30, tzinfo=TZ), sender
    )
    assert next_day["sent"] is True
    assert len(sender.calls) == 2


def test_a_failure_is_retried_after_the_backoff(world, session_factory) -> None:
    configure(session_factory)
    failing = _Sender(ok=False)
    first = reminder_loop.run_reminder_tick(at(8, 30), failing)
    assert first["sent"] is False and first["reason"] == "failed"

    immediate = reminder_loop.run_reminder_tick(at(8, 31), failing)
    assert immediate["reason"] == "retry_backoff"

    retry = reminder_loop.run_reminder_tick(at(8, 45), _Sender())
    assert retry["sent"] is True


def test_quiet_hours_stop_the_tick_before_touching_the_queue(world, session_factory, monkeypatch) -> None:
    configure(session_factory)
    called: list[int] = []
    monkeypatch.setattr(
        reminder_loop, "read_due_snapshot", lambda *a, **k: called.append(1)
    )
    result = reminder_loop.run_reminder_tick(at(2, 0), _Sender())
    assert result["reason"] == "quiet_hours"
    assert called == []


def test_a_sent_slot_never_queries_the_queue_again(world, session_factory, monkeypatch) -> None:
    configure(session_factory)
    sender = _Sender()
    reminder_loop.run_reminder_tick(at(8, 30), sender)

    called: list[int] = []
    monkeypatch.setattr(
        reminder_loop, "read_due_snapshot", lambda *a, **k: called.append(1)
    )
    result = reminder_loop.run_reminder_tick(at(8, 40), sender)
    assert result["reason"] == "already_sent"
    assert called == []


# --- 闲置拉回 ---------------------------------------------------------------


def _idle_only(session_factory, **overrides) -> None:
    configure(
        session_factory,
        morning_enabled=False,
        evening_enabled=False,
        idle_enabled=True,
        idle_after_minutes=60,
        idle_repeat_minutes=5,
        **overrides,
    )


def test_idle_waits_for_activity_today_first(world, session_factory) -> None:
    _idle_only(session_factory)
    # 今天一次都没动过：这是"还没开始"，不是"忘了回来"。
    assert reminder_loop.run_reminder_tick(at(10, 30), _Sender())["sent"] is False


def test_idle_fires_then_waits_for_the_repeat_interval(world, session_factory) -> None:
    _idle_only(session_factory)
    world.worked_until(at(9, 0))
    sender = _Sender()

    first = reminder_loop.run_reminder_tick(at(10, 5), sender)
    assert first["sent"] is True and first["kind"] == "idle"

    # 五分钟内不重复。
    assert reminder_loop.run_reminder_tick(at(10, 6), sender)["sent"] is False
    second = reminder_loop.run_reminder_tick(at(10, 11), sender)
    assert second["sent"] is True
    assert len(sender.calls) == 2
    # 同一条闲置提醒共用一个通知 id，iOS 上互相覆盖。
    assert sender.calls[0]["notification_id"] == "memory-anki-idle"


def test_idle_resets_when_you_come_back(world, session_factory) -> None:
    _idle_only(session_factory)
    world.worked_until(at(9, 0))
    reminder_loop.run_reminder_tick(at(10, 5), _Sender())

    world.worked_until(at(10, 6))
    assert reminder_loop.run_reminder_tick(at(10, 7), _Sender())["sent"] is False
    # 从新的动作时间重新计 60 分钟。
    assert reminder_loop.run_reminder_tick(at(10, 50), _Sender())["sent"] is False
    world.worked_until(at(10, 6))
    assert reminder_loop.run_reminder_tick(at(11, 10), _Sender())["sent"] is True


def test_idle_respects_its_max_repeats(world, session_factory) -> None:
    _idle_only(session_factory, idle_max_repeats=1)
    world.worked_until(at(9, 0))
    sender = _Sender()
    assert reminder_loop.run_reminder_tick(at(10, 5), sender)["sent"] is True
    assert reminder_loop.run_reminder_tick(at(10, 20), sender)["sent"] is False


# --- 到期就绪 ---------------------------------------------------------------


def _ready_only(session_factory, **overrides) -> None:
    configure(
        session_factory,
        morning_enabled=False,
        evening_enabled=False,
        ready_enabled=True,
        ready_min_units=5,
        ready_min_gap_minutes=15,
        **overrides,
    )


def test_ready_needs_a_new_batch_above_the_baseline(world, session_factory) -> None:
    _ready_only(session_factory)
    sender = _Sender()
    # 第一次 tick 只建立基准，不打扰。
    assert reminder_loop.run_reminder_tick(at(10, 0), sender)["sent"] is False

    world.snapshot = DueSnapshot(due_count=45, ready_now_count=45, completed_today=0)
    assert reminder_loop.run_reminder_tick(at(10, 1), sender)["sent"] is False

    world.snapshot = DueSnapshot(due_count=50, ready_now_count=50, completed_today=0)
    sent = reminder_loop.run_reminder_tick(at(10, 2), sender)
    assert sent["sent"] is True and sent["kind"] == "ready"
    assert "50" in sender.calls[0]["body"] or "5" in sender.calls[0]["title"]


def test_ready_is_throttled_and_baseline_drops_after_studying(world, session_factory) -> None:
    _ready_only(session_factory)
    sender = _Sender()
    reminder_loop.run_reminder_tick(at(10, 0), sender)
    world.snapshot = DueSnapshot(due_count=60, ready_now_count=60)
    assert reminder_loop.run_reminder_tick(at(10, 1), sender)["sent"] is True

    # 学过之后队列变小，基线跟着降。
    world.snapshot = DueSnapshot(due_count=20, ready_now_count=20)
    reminder_loop.run_reminder_tick(at(10, 2), sender)
    world.snapshot = DueSnapshot(due_count=24, ready_now_count=24)
    assert reminder_loop.run_reminder_tick(at(10, 3), sender)["sent"] is False


# --- 整点小结 ---------------------------------------------------------------


def _hourly_only(session_factory, **overrides) -> None:
    configure(
        session_factory,
        morning_enabled=False,
        evening_enabled=False,
        hourly_enabled=True,
        **overrides,
    )


def test_hourly_sends_at_the_top_of_the_hour_only(world, session_factory) -> None:
    _hourly_only(session_factory)
    sender = _Sender()
    assert reminder_loop.run_reminder_tick(at(9, 30), sender)["sent"] is False
    first = reminder_loop.run_reminder_tick(at(10, 0), sender)
    assert first["sent"] is True and first["kind"] == "hourly"
    assert reminder_loop.run_reminder_tick(at(10, 3), sender)["sent"] is False
    assert reminder_loop.run_reminder_tick(at(11, 0), sender)["sent"] is True


def test_hourly_leads_with_what_you_finished(world, session_factory) -> None:
    _hourly_only(session_factory)
    world.snapshot = DueSnapshot(
        due_count=94,
        ready_now_count=80,
        completed_today=86,
        completed_last_hour=42,
        streak_days=12,
    )
    sender = _Sender()
    reminder_loop.run_reminder_tick(at(10, 0), sender)
    assert sender.calls[0]["title"] == "连续第 12 天"
    assert "今天累计 86 张" in sender.calls[0]["body"]


def test_hourly_celebrates_a_new_hundred_once(world, session_factory) -> None:
    _hourly_only(session_factory)
    world.snapshot = DueSnapshot(
        due_count=94,
        ready_now_count=80,
        completed_today=120,
        completed_last_hour=42,
        streak_days=12,
    )
    sender = _Sender()
    reminder_loop.run_reminder_tick(at(10, 0), sender)
    assert sender.calls[0]["title"] == "今天第 120 张"
    # 同一档位再发一次不再重复庆祝。
    reminder_loop.run_reminder_tick(at(11, 0), sender)
    assert sender.calls[1]["title"] != "今天第 120 张"


# --- 每日上限 ---------------------------------------------------------------


def test_daily_cap_stops_everything(world, session_factory) -> None:
    configure(session_factory, morning_enabled=False, evening_enabled=False,
              idle_enabled=True, daily_cap=1)
    world.worked_until(at(9, 0))
    sender = _Sender()
    assert reminder_loop.run_reminder_tick(at(10, 5), sender)["sent"] is True
    capped = reminder_loop.run_reminder_tick(at(10, 30), sender)
    assert capped["sent"] is False
    assert capped["reason"] == "daily_cap"


def test_priority_prefers_ready_over_idle(world, session_factory) -> None:
    configure(
        session_factory,
        morning_enabled=False,
        evening_enabled=False,
        idle_enabled=True,
        ready_enabled=True,
        ready_min_units=1,
    )
    world.worked_until(at(9, 0))
    sender = _Sender()
    reminder_loop.run_reminder_tick(at(9, 30), sender)  # 建立就绪基准
    world.snapshot = DueSnapshot(due_count=60, ready_now_count=60)
    result = reminder_loop.run_reminder_tick(at(11, 0), sender)
    assert result["kind"] == "ready"


def test_quiet_window_is_configurable(world, session_factory) -> None:
    configure(session_factory, quiet_start_hour=22, quiet_end_hour=8)
    assert reminder_loop.run_reminder_tick(at(23, 0), _Sender())["reason"] == "quiet_hours"
    world.snapshot = DueSnapshot(due_count=5, ready_now_count=5)
    assert reminder_loop.run_reminder_tick(at(9, 0), _Sender())["sent"] is True


def test_a_failed_send_does_not_count_toward_the_cap(world, session_factory) -> None:
    configure(session_factory, morning_enabled=False, evening_enabled=False,
              idle_enabled=True, daily_cap=1)
    world.worked_until(at(9, 0))
    failing = _Sender(ok=False)
    assert reminder_loop.run_reminder_tick(at(10, 5), failing)["sent"] is False
    assert reminder_loop.run_reminder_tick(at(10, 20), _Sender())["sent"] is True


def test_time_before_threshold_does_not_nag(world, session_factory) -> None:
    _idle_only(session_factory)
    world.worked_until(at(9, 0))
    assert reminder_loop.run_reminder_tick(at(9, 59), _Sender())["sent"] is False
    world.worked_until(at(9, 0) - timedelta(minutes=1))


def test_a_tap_on_the_phone_counts_as_activity(world, session_factory, monkeypatch) -> None:
    """只认评分和保存脑图的话，在手机上翻卡看书会被判成"没动"。"""
    _idle_only(session_factory)
    world.worked_until(at(9, 0))
    # 10:20 在手机上点过（心跳），10:30 检查：才停了 10 分钟，不该催。
    monkeypatch.setattr(
        reminder_loop,
        "last_ui_seen",
        lambda: at(10, 20).astimezone(UTC).replace(tzinfo=None),
    )
    assert reminder_loop.run_reminder_tick(at(10, 30), _Sender())["sent"] is False


def test_an_old_heartbeat_still_lets_the_reminder_fire(world, session_factory, monkeypatch) -> None:
    _idle_only(session_factory)
    world.worked_until(at(8, 0))
    monkeypatch.setattr(
        reminder_loop,
        "last_ui_seen",
        lambda: at(8, 30).astimezone(UTC).replace(tzinfo=None),
    )
    # 最后一次交互是 8:30，到 10:30 已经停了 2 小时。
    assert reminder_loop.run_reminder_tick(at(10, 30), _Sender())["sent"] is True
