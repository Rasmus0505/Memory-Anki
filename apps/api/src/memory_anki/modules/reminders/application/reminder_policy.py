"""三类高频提醒的候选生成，以及"同一分钟只发一条"的裁决。

每种提醒都先回答两个问题：现在该不该发？如果发，它比别的高频提醒更值得打断你吗？
裁决按固定优先级：早上 > 晚上 > 到期就绪 > 闲置拉回 > 整点小结。
整点小结永远排最后，因为它是唯一"不要求你做事"的通知。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from memory_anki.modules.reminders.application.activity_probe import ActivitySnapshot
from memory_anki.modules.reminders.domain.schemas import (
    KIND_HOURLY,
    KIND_IDLE,
    KIND_PRIORITY,
    KIND_READY,
    SKIP_HOUR_DONE,
    SKIP_NO_NEW_READY,
    SKIP_NOT_IDLE,
    ReminderRuntime,
    ReminderSettings,
)


@dataclass(frozen=True)
class Candidate:
    kind: str
    key: str
    priority: int
    detail: dict[str, Any] = field(default_factory=dict)


def _key(kind: str, now_local: datetime) -> str:
    """投递键 <类型>:<时分>。唯一约束 (study_day, slot) 因此每分钟最多放行一条。"""
    return f"{kind}:{now_local:%H%M}"


def idle_decision(
    *,
    settings: ReminderSettings,
    runtime: ReminderRuntime,
    activity: ActivitySnapshot,
    now_local: datetime,
    now_utc: datetime,
) -> tuple[Candidate | None, str]:
    if not settings.idle_enabled:
        return None, SKIP_NOT_IDLE
    last = activity.last_activity_at
    if last is None:
        if settings.idle_requires_activity_today:
            # 今天还没动过：这是"还没开始"，交给早上/晚上概览，不是"忘了回来"。
            return None, SKIP_NOT_IDLE
        last = now_utc - timedelta(hours=24)
    idle_for = now_utc - last
    if idle_for < timedelta(minutes=settings.idle_after_minutes):
        return None, SKIP_NOT_IDLE
    if settings.idle_max_repeats and runtime.idle_repeats >= settings.idle_max_repeats:
        return None, SKIP_NOT_IDLE
    if runtime.idle_last_at is not None:
        since_last = now_utc - runtime.idle_last_at
        if since_last < timedelta(minutes=settings.idle_repeat_minutes):
            return None, SKIP_NOT_IDLE
    return (
        Candidate(
            kind=KIND_IDLE,
            key=_key(KIND_IDLE, now_local),
            priority=KIND_PRIORITY[KIND_IDLE],
            detail={"idle_minutes": int(idle_for.total_seconds() // 60)},
        ),
        "",
    )


def ready_decision(
    *,
    settings: ReminderSettings,
    runtime: ReminderRuntime,
    ready_count: int,
    baseline: int,
    now_local: datetime,
    now_utc: datetime,
) -> tuple[Candidate | None, str]:
    if not settings.ready_enabled:
        return None, ""
    new_ready = max(0, ready_count - baseline)
    if new_ready < settings.ready_min_units:
        return None, SKIP_NO_NEW_READY
    if runtime.last_ready_at is not None:
        since_last = now_utc - runtime.last_ready_at
        if since_last < timedelta(minutes=settings.ready_min_gap_minutes):
            return None, SKIP_NO_NEW_READY
    return (
        Candidate(
            kind=KIND_READY,
            key=_key(KIND_READY, now_local),
            priority=KIND_PRIORITY[KIND_READY],
            detail={"new_ready": new_ready, "ready_total": ready_count},
        ),
        "",
    )


def hourly_decision(
    *,
    settings: ReminderSettings,
    runtime: ReminderRuntime,
    now_local: datetime,
) -> tuple[Candidate | None, str]:
    if not settings.hourly_enabled:
        return None, ""
    hour_key = f"{now_local.date().isoformat()}T{now_local.hour:02d}"
    if runtime.last_hour_key == hour_key:
        return None, SKIP_HOUR_DONE
    # 只在整点后 5 分钟内发；进程在整点那一分钟没起来就跳过这一小时，不补。
    if now_local.minute > 5:
        return None, SKIP_HOUR_DONE
    return (
        Candidate(
            kind=KIND_HOURLY,
            key=f"{KIND_HOURLY}:{now_local.hour:02d}",
            priority=KIND_PRIORITY[KIND_HOURLY],
            detail={"hour_key": hour_key, "hour": now_local.hour},
        ),
        "",
    )


def pick(candidates: list[Candidate]) -> Candidate | None:
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.priority)
