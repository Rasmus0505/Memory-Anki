"""到点判定：纯函数，时间由调用方注入。

两个阶段分开，是因为到期统计是一次真实查询：
``candidate_slot`` 只看钟点（每分钟都能廉价调用），
只有确实落在某个窗口里才去读数据库算到期数。
"""

from __future__ import annotations

from datetime import datetime, timedelta

from memory_anki.modules.reminders.domain.schemas import (
    KIND_EVENING,
    KIND_MORNING,
    MAX_SEND_ATTEMPTS,
    RETRY_BACKOFF_MINUTES,
    SEND_NOW,
    SKIP_ALREADY_SENT,
    SKIP_ALREADY_STUDIED,
    SKIP_ATTEMPTS_EXHAUSTED,
    SKIP_BELOW_THRESHOLD,
    SKIP_DISABLED,
    SKIP_NOTHING_DUE,
    SKIP_RETRY_BACKOFF,
    SKIP_UNCONFIGURED,
    DeliveryState,
    DueSnapshot,
    ReminderDecision,
    ReminderSettings,
)

_STATUS_SENT = "sent"


def in_quiet_hours(now_local: datetime, settings: ReminderSettings) -> bool:
    """免打扰时段；开始 > 结束 表示跨零点（例如 22 → 8）。

    默认 0:00–8:00。学习日从凌晨 3 点起算的规则是另一件事：
    它决定"今天算哪一天"，这里只决定"现在能不能响"。
    """
    start = settings.quiet_start_hour
    end = settings.quiet_end_hour
    hour = now_local.hour
    if start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def _slot_start(now_local: datetime, settings: ReminderSettings, slot: str) -> datetime:
    at = settings.morning_time if slot == KIND_MORNING else settings.evening_time
    return datetime.combine(now_local.date(), at, tzinfo=now_local.tzinfo)


def slot_window(
    now_local: datetime, settings: ReminderSettings, slot: str
) -> tuple[datetime, datetime]:
    """某时段的 [开始, 结束) 窗口，用本地挂钟时间表示。

    窗口长度包含补发：电脑关机错过整点，开机后仍在窗口内就补一条。
    """
    start = _slot_start(now_local, settings, slot)
    minutes = (
        settings.morning_window_minutes
        if slot == KIND_MORNING
        else settings.evening_window_minutes
    )
    return start, start + timedelta(minutes=minutes)


def candidate_slot(now_local: datetime, settings: ReminderSettings) -> str | None:
    """当前落在早上/晚上哪个窗口里；不在任何窗口返回 None。"""
    if not settings.enabled or not settings.configured:
        return None
    if in_quiet_hours(now_local, settings):
        return None
    for slot, enabled in (
        (KIND_MORNING, settings.morning_enabled),
        (KIND_EVENING, settings.evening_enabled),
    ):
        if not enabled:
            continue
        start, end = slot_window(now_local, settings, slot)
        if start <= now_local < end:
            return slot
    return None


def blocked_reason(state: DeliveryState, now_utc: datetime) -> str | None:
    """这个投递键本身是否已经"封口"。

    独立出来是因为循环要先用它短路：已经发过的那一分钟不能再查一次到期数。
    """
    if state.status == _STATUS_SENT:
        return SKIP_ALREADY_SENT
    if state.attempts >= MAX_SEND_ATTEMPTS:
        return SKIP_ATTEMPTS_EXHAUSTED
    if state.last_attempt_at is not None:
        elapsed = now_utc - state.last_attempt_at
        if elapsed < timedelta(minutes=RETRY_BACKOFF_MINUTES):
            return SKIP_RETRY_BACKOFF
    return None


def evaluate(
    slot: str,
    settings: ReminderSettings,
    snapshot: DueSnapshot,
    state: DeliveryState,
    now_utc: datetime,
) -> ReminderDecision:
    """早上/晚上两条的最终判定。"""
    if not settings.enabled:
        return ReminderDecision(False, slot, SKIP_DISABLED)
    if not settings.configured:
        return ReminderDecision(False, slot, SKIP_UNCONFIGURED)
    reason = blocked_reason(state, now_utc)
    if reason is not None:
        return ReminderDecision(False, slot, reason)
    if snapshot.due_count <= 0:
        return ReminderDecision(False, slot, SKIP_NOTHING_DUE)
    if slot == KIND_MORNING and settings.due_threshold > 0:
        if snapshot.due_count < settings.due_threshold:
            return ReminderDecision(False, slot, SKIP_BELOW_THRESHOLD)
    if slot == KIND_EVENING and snapshot.completed_today > 0:
        # 晚上只在"今天一张都没评"时催，学过了就不再打扰。
        return ReminderDecision(False, slot, SKIP_ALREADY_STUDIED)
    return ReminderDecision(True, slot, SEND_NOW)


def next_reminder_at(
    now_local: datetime, settings: ReminderSettings
) -> tuple[datetime, str] | None:
    """下一次计划发送的本地时间与类型；关闭或未配置时返回 None。

    只回答"计划"，不代表那一刻一定有卡到期。
    """
    if not settings.enabled or not settings.configured:
        return None
    candidates: list[tuple[datetime, str]] = []
    for day_offset in (0, 1):
        day = now_local + timedelta(days=day_offset)
        for slot, enabled in (
            (KIND_MORNING, settings.morning_enabled),
            (KIND_EVENING, settings.evening_enabled),
        ):
            if not enabled:
                continue
            start = _slot_start(day, settings, slot)
            if start > now_local:
                candidates.append((start, slot))
    if not candidates:
        return None
    return min(candidates, key=lambda item: item[0])
