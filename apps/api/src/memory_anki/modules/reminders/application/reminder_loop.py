"""提醒循环：每分钟一跳，生成候选 → 裁决 → 发送 → 记账。

形状对齐 ``modules/backups/application/backup_lifecycle.py``：一个守护线程、
一个 stop event、启动时先立刻跑一次（这就是"关机错过后开机补发"）。

一分钟一跳的成本主要来自"到期数"那次查询，所以它是惰性的：
只有当某个候选真的需要数字时才去查，且同一分钟内复用结果。
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

from memory_anki.core.time import resolve_local_timezone, study_day_of
from memory_anki.infrastructure.db._tables._base import get_session
from memory_anki.modules.reminders.application.activity_probe import read_activity
from memory_anki.modules.reminders.application.due_summary import read_due_snapshot
from memory_anki.modules.reminders.application.presence import last_seen as last_ui_seen
from memory_anki.modules.reminders.application.reminder_message import compose
from memory_anki.modules.reminders.application.reminder_policy import (
    Candidate,
    hourly_decision,
    idle_decision,
    pick,
    ready_decision,
)
from memory_anki.modules.reminders.application.reminder_schedule import (
    blocked_reason,
    candidate_slot,
    evaluate,
    in_quiet_hours,
)
from memory_anki.modules.reminders.application.reminder_settings import read_settings
from memory_anki.modules.reminders.application.reminder_state import (
    read_runtime,
    write_runtime,
)
from memory_anki.modules.reminders.domain.schemas import (
    KIND_HOURLY,
    KIND_IDLE,
    KIND_PRIORITY,
    KIND_READY,
    DeliveryState,
    DueSnapshot,
    ReminderRuntime,
)
from memory_anki.modules.reminders.infrastructure.bark_gateway import send_bark
from memory_anki.modules.reminders.infrastructure.delivery_store import (
    count_sent_on,
    load_delivery_states,
    prune_deliveries,
    record_attempt,
)

logger = logging.getLogger(__name__)

TICK_SECONDS = 60.0
_PENDING = DeliveryState()


def _state_for(session, study_day, key: str) -> DeliveryState:
    return load_delivery_states(session, study_day).get(key, _PENDING)


def _load_snapshot(
    session,
    study_day,
    now_utc: datetime,
    cache: dict[bool, DueSnapshot],
    *,
    streak: bool,
    settings,
) -> DueSnapshot:
    if streak not in cache:
        cache[streak] = read_due_snapshot(
            session,
            study_day,
            now=now_utc,
            include_streak=streak,
            quiet_start_hour=settings.quiet_start_hour,
        )
    return cache[streak]


def run_reminder_tick(
    now: datetime | None = None,
    send: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """跑一次判定。返回本轮结果，便于测试与设置页展示。"""
    session = get_session()
    try:
        settings = read_settings(session)
        if not settings.enabled or not settings.configured:
            return {"sent": False, "reason": "disabled"}

        zone = resolve_local_timezone()
        now_local = now or datetime.now(zone)
        # 投递时间必须和判定用的是同一个瞬间，否则注入的假时钟会和真实时钟打架。
        now_utc = now_local.astimezone(UTC).replace(tzinfo=None)
        if in_quiet_hours(now_local, settings):
            return {"sent": False, "reason": "quiet_hours"}

        study_day = study_day_of(now_local, zone)
        runtime = read_runtime(session).for_day(study_day.isoformat())

        activity = read_activity(session, study_day, now=now_utc)
        # 前端心跳（点击/按键/触摸）也算动作：只认评分和保存脑图的话，
        # 你在手机上翻卡看书会被判成"没动"。
        seen = last_ui_seen()
        if seen is not None and (
            activity.last_activity_at is None or seen > activity.last_activity_at
        ):
            activity = replace(activity, last_activity_at=seen, started_today=True)
        if activity.last_activity_at != runtime.last_activity_at:
            # 又动过了：闲置轮次从头计。
            runtime = replace(
                runtime,
                idle_repeats=0,
                last_activity_at=activity.last_activity_at,
            )

        cache: dict[bool, DueSnapshot] = {}
        candidates: list[Candidate] = []
        reasons: list[str] = []

        slot = candidate_slot(now_local, settings)
        if slot is not None:
            state = _state_for(session, study_day, slot)
            blocked = blocked_reason(state, now_utc)
            if blocked is not None:
                reasons.append(blocked)
            else:
                decision = evaluate(
                    slot,
                    settings,
                    _load_snapshot(session, study_day, now_utc, cache, streak=False, settings=settings),
                    state,
                    now_utc,
                )
                if decision.send:
                    candidates.append(
                        Candidate(slot, slot, KIND_PRIORITY[slot], {})
                    )
                else:
                    reasons.append(decision.reason)

        if settings.ready_enabled:
            ready_now = _load_snapshot(
                session, study_day, now_utc, cache, streak=False, settings=settings
            ).ready_now_count
            baseline = ready_now if runtime.ready_baseline is None else runtime.ready_baseline
            # 学过之后基线跟着降，否则"今天再也涨不回来"。
            lowered = min(baseline, ready_now)
            if lowered != runtime.ready_baseline:
                runtime = replace(runtime, ready_baseline=lowered)
            candidate, reason = ready_decision(
                settings=settings,
                runtime=runtime,
                ready_count=ready_now,
                baseline=baseline,
                now_local=now_local,
                now_utc=now_utc,
            )
            if candidate is not None:
                candidates.append(candidate)
            elif reason:
                reasons.append(reason)

        if settings.idle_enabled:
            candidate, reason = idle_decision(
                settings=settings,
                runtime=runtime,
                activity=activity,
                now_local=now_local,
                now_utc=now_utc,
            )
            if candidate is not None:
                candidates.append(candidate)
            elif reason:
                reasons.append(reason)

        if settings.hourly_enabled:
            candidate, reason = hourly_decision(
                settings=settings, runtime=runtime, now_local=now_local
            )
            if candidate is not None:
                candidates.append(candidate)
            elif reason:
                reasons.append(reason)

        winner = pick(candidates)
        if winner is None:
            write_runtime(session, runtime)
            session.commit()
            return {
                "sent": False,
                "reason": reasons[0] if reasons else "nothing_due",
            }

        if settings.daily_cap:
            if count_sent_on(session, study_day) >= settings.daily_cap:
                write_runtime(session, runtime)
                session.commit()
                return {"sent": False, "reason": "daily_cap", "kind": winner.kind}

        state = _state_for(session, study_day, winner.key)
        blocked = blocked_reason(state, now_utc)
        if blocked is not None:
            write_runtime(session, runtime)
            session.commit()
            return {"sent": False, "reason": blocked, "kind": winner.kind}

        snapshot = _load_snapshot(
            session,
            study_day,
            now_utc,
            cache,
            streak=winner.kind == KIND_HOURLY,
            settings=settings,
        )
        since_last_minutes = (
            int((now_utc - activity.last_activity_at).total_seconds() // 60)
            if activity.last_activity_at is not None
            else 0
        )
        message = compose(
            winner.kind,
            settings,
            snapshot,
            winner.detail,
            runtime_done_before=runtime.last_hour_done,
            since_last_minutes=since_last_minutes,
        )
        result = (send or send_bark)(
            settings.bark_key,
            message.title,
            message.body,
            group=settings.bark_group,
            # 同一条闲置提醒共用一个 id：iOS 上互相覆盖，而不是堆成一片。
            notification_id=(
                f"memory-anki-{winner.kind}" if winner.kind == KIND_IDLE else None
            ),
            icon_url=settings.icon_url or None,
        )
        record_attempt(
            session,
            study_day=study_day,
            slot=winner.key,
            ok=bool(result.ok),
            title=message.title,
            body=message.body,
            http_status=result.http_status,
            error=result.error,
            now=now_utc,
        )
        runtime = _apply_winner(runtime, winner, snapshot, now_utc)
        write_runtime(session, runtime)
        session.commit()
        if not result.ok:
            logger.warning("review reminder delivery failed: %s", result.error)
        return {
            "sent": bool(result.ok),
            "reason": "sent" if result.ok else "failed",
            "kind": winner.kind,
            "title": message.title,
            "error": result.error,
        }
    except Exception:  # 一个提醒周期出错不能拖垮服务进程
        session.rollback()
        logger.exception("review reminder tick failed")
        return {"sent": False, "reason": "error"}
    finally:
        session.close()


def _apply_winner(
    runtime: ReminderRuntime,
    winner: Candidate,
    snapshot: DueSnapshot,
    now_utc: datetime,
) -> ReminderRuntime:
    if winner.kind == KIND_IDLE:
        return replace(
            runtime, idle_last_at=now_utc, idle_repeats=runtime.idle_repeats + 1
        )
    if winner.kind == KIND_HOURLY:
        return replace(
            runtime,
            last_hour_key=str(winner.detail.get("hour_key") or ""),
            last_hour_done=snapshot.completed_today,
        )
    if winner.kind == KIND_READY:
        return replace(
            runtime,
            ready_baseline=snapshot.ready_now_count,
            last_ready_at=now_utc,
        )
    return runtime


_STOP = threading.Event()
_THREAD: threading.Thread | None = None
_THREAD_LOCK = threading.Lock()


def _loop() -> None:
    session = get_session()
    try:
        prune_deliveries(session)
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("could not prune reminder deliveries")
    finally:
        session.close()

    while not _STOP.is_set():
        run_reminder_tick()
        _STOP.wait(TICK_SECONDS)


def start_reminder_loop() -> threading.Thread | None:
    global _THREAD
    with _THREAD_LOCK:
        if _THREAD is not None and _THREAD.is_alive():
            return _THREAD
        _STOP.clear()
        _THREAD = threading.Thread(target=_loop, name="memory-anki-reminders", daemon=True)
        _THREAD.start()
        return _THREAD


def stop_reminder_loop(timeout: float = 2.0) -> None:
    _STOP.set()
    thread = _THREAD
    if thread is not None and thread.is_alive():
        thread.join(timeout)
