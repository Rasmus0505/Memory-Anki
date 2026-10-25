"""通知文案。

三条原则：

1. 锁屏上只放一件最重要的事，细节进正文。
2. **永远先说你已经做成的**，剩余放第二位。每小时提醒你"还剩 200 张"只会让人
   想关掉通知；"今天已经 120 张"才会让人想再刷一轮。
3. 紧迫感来自**时间**，不来自数量。"还剩 200 张"是个抽象数字；
   "最久一张已经等了 5 天""距上次复习 9 小时"才是会让人坐下来的东西——
   前者对应遗忘曲线，后者对应"我今天是不是又要断"。

所以正文里只要拿到时间，就优先放时间，数字退到第二位。
``vague`` 模式锁屏不泄露学习数据，但仍然保留成就感和"该动了"的语气。
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
    if hours < 24:
        return f"{hours} 小时"
    return f"{hours // 24} 天"


def _remaining_suffix(remaining: int) -> str:
    return f"还剩 {remaining} 张" if remaining > 0 else "今天全清完了"


def _overdue_clause(days: int) -> str:
    """逾期天数：最具体、最能推动行动的一个数。"""
    if days <= 0:
        return ""
    return f"最久一张逾期 {days} 天"


def _since_last_clause(minutes: int) -> str:
    if minutes <= 0:
        return ""
    return f"距上次复习 {_duration(minutes)}"


def _join(*parts: str) -> str:
    return " · ".join(part for part in parts if part)


def _percent(value: float | None) -> str:
    if value is None:
        return ""
    return f"{max(0, min(100, round(value * 100)))}%"


def _retention_clause(snapshot: DueSnapshot, *, lowest: bool = False) -> str:
    """记忆保留率。只在真的开始遗忘时才说，否则"还剩 97%"没有紧迫感。"""
    value = snapshot.lowest_retention if lowest else snapshot.average_retention
    if value is None or value >= 0.85:
        return ""
    label = "最弱一张只剩" if lowest else "记忆平均剩"
    return f"{label} {_percent(value)}"


def _time_left_clause(snapshot: DueSnapshot) -> str:
    """今天还剩多久。只在真的不多了的时候说，中午说"还剩 11 小时"等于没说。"""
    hours = snapshot.hours_left_today
    if hours <= 0 or hours > 6:
        return ""
    if hours < 1:
        return f"今天只剩 {int(hours * 60)} 分钟"
    return f"今天只剩 {int(hours)} 小时"


def _stalled_clause(snapshot: DueSnapshot) -> str:
    """今天累计停了多久 = 今天已过去的小时数 - 真正有产出的整点数。

    比"上次复习是几点"更接近"今天一共耽误了多少"，也解释了为什么累积得这么快。
    """
    elapsed = snapshot.elapsed_hours_today
    active = snapshot.active_hours_today
    if elapsed < 2:
        return ""
    stalled = int(elapsed) - active
    if stalled <= 0:
        return ""
    return f"今天累计停了 {stalled} 小时"


def _morning(settings: ReminderSettings, snapshot: DueSnapshot) -> ReminderMessage:
    if settings.content_mode == "vague":
        return ReminderMessage("今天的复习到点了", "打开 Memory Anki 看看今天要复习什么。")
    yesterday = snapshot.completed_yesterday
    # 最多两条：一个欠账 + 一个参照。三条挤在锁屏上等于没说。
    body = _join(
        _overdue_clause(snapshot.oldest_overdue_days) or _retention_clause(snapshot),
        f"昨天复习了 {yesterday} 张" if yesterday > 0 else "",
    )
    return ReminderMessage(
        f"今天 {snapshot.due_count} 张到期",
        body or "打开 Memory Anki 开始今天的复习",
    )


def _evening(
    settings: ReminderSettings,
    snapshot: DueSnapshot,
    since_last_minutes: int,
) -> ReminderMessage:
    if settings.content_mode == "vague":
        return ReminderMessage("今天的复习还没开始", "打开 Memory Anki 补上今天的进度。")
    # 期限 + 最重的欠账，正好两条。
    debt = (
        _overdue_clause(snapshot.oldest_overdue_days)
        or _retention_clause(snapshot)
        or _since_last_clause(since_last_minutes)
    )
    body = _join(_time_left_clause(snapshot), debt)
    return ReminderMessage(
        f"今天还有 {snapshot.due_count} 张没复习",
        body or "现在开始，先清掉一轮。",
    )


def _ready(
    settings: ReminderSettings, snapshot: DueSnapshot, detail: dict
) -> ReminderMessage:
    new_ready = int(detail.get("new_ready") or 0)
    total = int(detail.get("ready_total") or snapshot.due_count)
    if settings.content_mode == "vague":
        return ReminderMessage("有新的卡片到期了", "打开 Memory Anki 接着刷。")
    body = _join(
        f"现在一共 {total} 张",
        _overdue_clause(snapshot.oldest_overdue_days) or _retention_clause(snapshot),
    )
    return ReminderMessage(f"{new_ready} 张新到期", body)


def _idle(
    settings: ReminderSettings,
    snapshot: DueSnapshot,
    detail: dict,
    since_last_minutes: int,
) -> ReminderMessage:
    """闲置提醒的主语永远是"停了多久"，第一次也不例外。

    曾经第一次写"还在吗？"想显得温和，结果最关键的数字（已经停了一小时）
    被藏到了第二次提醒里——用户要的正是这个数。
    """
    minutes = int(detail.get("idle_minutes") or 0)
    title = f"已经 {_duration(minutes)}没动了"
    if settings.content_mode == "vague":
        return ReminderMessage(title, "打开 Memory Anki 接着上次的地方。")
    # 闲置这条的主题就是"你停了多久"，所以累计停顿时长要排在记忆保留率前面；
    # 有更硬的逾期欠账时才让位。
    debt = (
        _overdue_clause(snapshot.oldest_overdue_days)
        or _stalled_clause(snapshot)
        or _retention_clause(snapshot, lowest=True)
    )
    return ReminderMessage(
        title,
        _join(_remaining_suffix(snapshot.due_count), debt or "回来评 3 张就算接上了"),
    )


def _hourly(
    settings: ReminderSettings,
    snapshot: DueSnapshot,
    runtime_done_before: int,
    hour: int | None = None,
    since_last_minutes: int = 0,
) -> ReminderMessage:
    done = snapshot.completed_today
    remaining = snapshot.due_count
    last_hour = snapshot.completed_last_hour
    streak = snapshot.streak_days
    total = done + remaining
    # 小结最多带一个时间信号：逾期优先（它对应遗忘曲线）；
    # 没有逾期时，只在"这一小时完全没动"的情况下提距上次复习多久。
    urgency = (
        _overdue_clause(snapshot.oldest_overdue_days)
        or _retention_clause(snapshot)
        or _time_left_clause(snapshot)
        or (_since_last_clause(since_last_minutes) if last_hour == 0 else "")
    )

    if settings.content_mode == "vague":
        tail = f" · 连续第 {streak} 天" if streak >= 2 else ""
        return ReminderMessage("整点小结", f"今天已经复习了 {done} 张{tail}。")

    # 当天最后一条小结：换成"收工"的语气，别在最后一小时还在报剩余。
    if hour is not None and hour == (settings.quiet_start_hour - 1) % 24 and done > 0:
        return ReminderMessage(
            "今天收工",
            _join(
                f"{done} 张",
                f"连续第 {streak} 天" if streak >= 2 else "今天就到这儿",
                urgency,
            ),
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
            _join(
                f"连续第 {streak} 天" if streak >= 2 else f"已经 {done} 张",
                _remaining_suffix(remaining),
            ),
        )
    # 只在"刚刚超过"的那一刻说一次，之后每小时重复就成了废话。
    yesterday = snapshot.completed_yesterday
    if 0 < yesterday <= done and runtime_done_before < yesterday:
        return ReminderMessage(
            "超过昨天了",
            # 这条本身就是"超过了"，再叠欠账就成了三件事。
            _join(f"今天 {done} 张", f"昨天全天 {yesterday} 张"),
        )
    if streak >= 3:
        # 这一小时没动就别在正文里写个 0，"连续第 8 天"已经够有分量。
        body = (
            _join(f"今天累计 {done} 张", f"这一小时 {last_hour} 张", urgency)
            if last_hour > 0
            else _join(f"今天累计 {done} 张", urgency)
        )
        return ReminderMessage(f"连续第 {streak} 天", body)
    if last_hour == 0:
        return ReminderMessage(
            f"今天已经拿下 {done} 张",
            _join(_remaining_suffix(remaining), urgency) or "不着急",
        )
    return ReminderMessage(
        f"今天 {done} / {total}",
        _join(f"这一小时 {last_hour} 张", _remaining_suffix(remaining), urgency),
    )


def compose(
    kind: str,
    settings: ReminderSettings,
    snapshot: DueSnapshot,
    detail: dict | None = None,
    *,
    runtime_done_before: int = 0,
    since_last_minutes: int = 0,
) -> ReminderMessage:
    extra = detail or {}
    if kind == KIND_EVENING:
        return _evening(settings, snapshot, since_last_minutes)
    if kind == KIND_MORNING:
        return _morning(settings, snapshot)
    if kind == KIND_READY:
        return _ready(settings, snapshot, extra)
    if kind == KIND_IDLE:
        return _idle(settings, snapshot, extra, since_last_minutes)
    if kind == KIND_HOURLY:
        return _hourly(
            settings,
            snapshot,
            runtime_done_before,
            extra.get("hour"),
            since_last_minutes,
        )
    return ReminderMessage("该复习了", "打开 Memory Anki 继续今天的复习。")


def compose_test(snapshot: DueSnapshot) -> ReminderMessage:
    """设置页「发测试通知」用的文案，顺带证明取数正确。"""
    return ReminderMessage(
        "提醒通道正常",
        f"今天 {snapshot.due_count} 张到期 · 到点会按你的设置提醒你",
    )
