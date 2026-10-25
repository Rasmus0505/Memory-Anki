"""通知文案。

三条原则：

1. 锁屏上只放一件最重要的事，细节进正文。
2. **永远先说你已经做成的**，剩余放第二位。每小时提醒你"还剩 200 张"只会让人
   想关掉通知；"今天已经 120 张"才会让人想再刷一轮。
3. ``vague`` 模式锁屏不泄露学习数据，但仍然保留成就感（说累计，不说队列）。
"""

from __future__ import annotations

from dataclasses import dataclass

from memory_anki.modules.reminders.domain.schemas import (
    KIND_EVENING,
    KIND_HOURLY,
    KIND_IDLE,
    KIND_MORNING,
    KIND_READY,
    DueSnapshot,
    ReminderSettings,
)


@dataclass(frozen=True)
class ReminderMessage:
    title: str
    body: str


def _duration(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} 分钟"
    hours = minutes // 60
    return f"{hours} 小时"


def _remaining_suffix(remaining: int) -> str:
    return f"还剩 {remaining} 张" if remaining > 0 else "今天全清完了"


def _morning(settings: ReminderSettings, snapshot: DueSnapshot) -> ReminderMessage:
    if settings.content_mode == "vague":
        return ReminderMessage("今天的复习到点了", "打开 Memory Anki 看看今天要复习什么。")
    yesterday = snapshot.completed_yesterday
    body = (
        f"昨天复习了 {yesterday} 张 · 打开就能开始"
        if yesterday > 0
        else "打开 Memory Anki 开始今天的复习"
    )
    return ReminderMessage(f"今天 {snapshot.due_count} 张到期", body)


def _evening(settings: ReminderSettings, snapshot: DueSnapshot) -> ReminderMessage:
    if settings.content_mode == "vague":
        return ReminderMessage("今天的复习还没开始", "打开 Memory Anki 补上今天的进度。")
    return ReminderMessage(
        f"今天还有 {snapshot.due_count} 张没复习",
        "现在开始，先清掉一轮。",
    )


def _ready(
    settings: ReminderSettings, snapshot: DueSnapshot, detail: dict
) -> ReminderMessage:
    new_ready = int(detail.get("new_ready") or 0)
    total = int(detail.get("ready_total") or snapshot.due_count)
    if settings.content_mode == "vague":
        return ReminderMessage("有新的卡片到期了", "打开 Memory Anki 接着刷。")
    return ReminderMessage(
        f"{new_ready} 张新到期",
        f"刚放出来的 · 现在一共 {total} 张",
    )


def _idle(
    settings: ReminderSettings, snapshot: DueSnapshot, detail: dict
) -> ReminderMessage:
    minutes = int(detail.get("idle_minutes") or 0)
    if settings.content_mode == "vague":
        return ReminderMessage("回来继续？", "打开 Memory Anki 接着上次的地方。")
    if minutes <= settings.idle_after_minutes + settings.idle_repeat_minutes:
        # 第一声别像责备，给一个几乎不可能拒绝的动作。
        return ReminderMessage(
            "还在吗？",
            f"{_remaining_suffix(snapshot.due_count)} · 回来评 3 张就算接上了",
        )
    return ReminderMessage(
        f"已经 {_duration(minutes)}没动了",
        f"{_remaining_suffix(snapshot.due_count)} · 随时回来接着刷",
    )


def _hourly(
    settings: ReminderSettings,
    snapshot: DueSnapshot,
    runtime_done_before: int,
    hour: int | None = None,
) -> ReminderMessage:
    done = snapshot.completed_today
    remaining = snapshot.due_count
    last_hour = snapshot.completed_last_hour
    streak = snapshot.streak_days
    total = done + remaining

    if settings.content_mode == "vague":
        tail = f" · 连续第 {streak} 天" if streak >= 2 else ""
        return ReminderMessage("整点小结", f"今天已经复习了 {done} 张{tail}。")

    # 当天最后一条小结：换成"收工"的语气，别在最后一小时还在报剩余。
    if hour is not None and hour == (settings.quiet_start_hour - 1) % 24 and done > 0:
        return ReminderMessage(
            "今天收工",
            f"{done} 张 · 连续第 {streak} 天" if streak >= 2 else f"{done} 张，今天就到这儿",
        )
    if done > 0 and remaining == 0:
        return ReminderMessage(
            "今天的队列清完了",
            f"{done} 张 · 连续第 {streak} 天" if streak >= 2 else f"{done} 张，收工",
        )
    # 跨过整百才值得庆祝一次，否则天天"里程碑"就等于没有里程碑。
    if done >= 100 and done // 100 > runtime_done_before // 100:
        return ReminderMessage(
            f"今天第 {done} 张",
            f"连续第 {streak} 天 · {_remaining_suffix(remaining)}"
            if streak >= 2
            else f"已经 {done} 张 · {_remaining_suffix(remaining)}",
        )
    # 只在"刚刚超过"的那一刻说一次，之后每小时重复就成了废话。
    yesterday = snapshot.completed_yesterday
    if 0 < yesterday <= done and runtime_done_before < yesterday:
        return ReminderMessage(
            "超过昨天了",
            f"今天 {done} 张 · 昨天全天 {yesterday} 张",
        )
    if streak >= 3:
        # 这一小时没动就别在正文里写个 0，"连续第 8 天"已经够有分量。
        body = (
            f"这一小时 {last_hour} 张 · 今天累计 {done} 张"
            if last_hour > 0
            else f"今天累计 {done} 张 · 已经连着 {streak} 天了"
        )
        return ReminderMessage(f"连续第 {streak} 天", body)
    if last_hour == 0:
        return ReminderMessage(
            f"今天已经拿下 {done} 张",
            f"{_remaining_suffix(remaining)}，不着急",
        )
    return ReminderMessage(
        f"今天 {done} / {total}",
        f"这一小时 {last_hour} 张 · {_remaining_suffix(remaining)}",
    )


def compose(
    kind: str,
    settings: ReminderSettings,
    snapshot: DueSnapshot,
    detail: dict | None = None,
    *,
    runtime_done_before: int = 0,
) -> ReminderMessage:
    extra = detail or {}
    if kind == KIND_EVENING:
        return _evening(settings, snapshot)
    if kind == KIND_MORNING:
        return _morning(settings, snapshot)
    if kind == KIND_READY:
        return _ready(settings, snapshot, extra)
    if kind == KIND_IDLE:
        return _idle(settings, snapshot, extra)
    if kind == KIND_HOURLY:
        return _hourly(
            settings,
            snapshot,
            runtime_done_before,
            extra.get("hour"),
        )
    return ReminderMessage("该复习了", "打开 Memory Anki 继续今天的复习。")


def compose_test(snapshot: DueSnapshot) -> ReminderMessage:
    """设置页「发测试通知」用的文案，顺带证明取数正确。"""
    return ReminderMessage(
        "提醒通道正常",
        f"今天 {snapshot.due_count} 张到期 · 到点会按你的设置提醒你",
    )
