"""复习提醒 HTTP 接口。

Bark Key 只以打码形式离开服务端；``PUT`` 里省略 ``bark_key`` 表示保持原值，
所以前端可以只改时间而不必把 Key 再填一遍。

``POST /reminders/preview`` 用真实数据按指定类型发一条样例，
用来在设置页核对文案——它不写投递记录，也不消耗当天的时段。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.core.time import resolve_local_timezone, study_day_of
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.reminders.application.activity_probe import read_activity
from memory_anki.modules.reminders.application.due_summary import read_due_snapshot
from memory_anki.modules.reminders.application.presence import mark_seen as note_presence
from memory_anki.modules.reminders.application.reminder_message import (
    compose,
    compose_test,
)
from memory_anki.modules.reminders.application.reminder_settings import (
    mask_bark_key,
    read_settings,
    update_settings,
)
from memory_anki.modules.reminders.application.reminder_status import build_status
from memory_anki.modules.reminders.domain.schemas import (
    KIND_HOURLY,
    KIND_IDLE,
    KIND_READY,
    KINDS,
    DueSnapshot,
    ReminderSettings,
)
from memory_anki.modules.reminders.infrastructure.bark_gateway import send_bark

router = APIRouter(tags=["reminders"])


def _settings_payload(settings: ReminderSettings) -> dict[str, Any]:
    return {
        **settings.to_payload(),
        "bark_key_masked": mask_bark_key(settings.bark_key),
        "bark_configured": settings.configured,
    }


@router.get("/reminders/settings")
def api_get_reminder_settings(s: Session = Depends(session_dep)):
    return {"settings": _settings_payload(read_settings(s)), "status": build_status(s)}


@router.put("/reminders/settings")
def api_update_reminder_settings(data: dict | None = None, s: Session = Depends(session_dep)):
    settings = update_settings(s, data if isinstance(data, dict) else {})
    return {"settings": _settings_payload(settings), "status": build_status(s)}


@router.post("/reminders/activity")
def api_note_activity():
    """前端在真实交互时打的点。不打库、不记账，只更新内存里的"最后动作时间"。"""
    moment = note_presence()
    return {"ok": True, "at": moment.isoformat(timespec="seconds") + "Z"}


@router.get("/reminders/status")
def api_reminder_status(s: Session = Depends(session_dep)):
    return build_status(s)


@router.post("/reminders/test")
def api_send_test_reminder(s: Session = Depends(session_dep)):
    """立即发一条测试通知；顺带证明取数正确（文案里带今天的到期数）。"""
    settings = read_settings(s)
    if not settings.configured:
        return {"ok": False, "error": "尚未填写 Bark Key"}
    zone = resolve_local_timezone()
    now_local = datetime.now(zone)
    snapshot = read_due_snapshot(s, study_day_of(now_local, zone))
    message = compose_test(snapshot)
    result = send_bark(
        settings.bark_key,
        message.title,
        message.body,
        group=settings.bark_group,
        icon_url=settings.icon_url or None,
    )
    return {"ok": result.ok, "error": result.error, "title": message.title, "body": message.body}


@router.post("/reminders/preview")
def api_preview_reminder(data: dict | None = None, s: Session = Depends(session_dep)):
    """按类型发一条真实样例，用来核对文案。"""
    scenario = str((data or {}).get("scenario") or "").strip()
    demo = bool((data or {}).get("demo")) or bool(scenario)
    kind = str((data or {}).get("kind") or "").strip()
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail=f"unknown reminder kind: {kind}")
    settings = read_settings(s)
    if not settings.configured:
        return {"ok": False, "error": "尚未填写 Bark Key"}

    zone = resolve_local_timezone()
    now_local = datetime.now(zone)
    now_utc = now_local.astimezone(UTC).replace(tzinfo=None)
    if demo:
        # 演示用的一组"有欠账"数据：让设置页能看全文案，
        # 而不必等到自己真的积压 19 天。不写库、不记账。
        snapshot = DueSnapshot(
            due_count=68,
            ready_now_count=61,
            completed_today=86,
            completed_yesterday=60,
            completed_last_hour=0,
            streak_days=9,
            # scenario="decay" 演示"没有积压、但记忆在流失"的另一种形态。
            oldest_overdue_days=0 if scenario == "decay" else 5,
            average_retention=0.62,
            lowest_retention=0.41,
            at_risk_units=17,
            elapsed_hours_today=14,
            active_hours_today=2,
            hours_left_today=1.5,
        )
    else:
        snapshot = read_due_snapshot(
            s,
            study_day_of(now_local, zone),
            now=now_utc,
            include_streak=kind == KIND_HOURLY,
            quiet_start_hour=settings.quiet_start_hour,
        )
    detail: dict[str, Any] = {}
    if kind == KIND_IDLE:
        detail = {
            "idle_minutes": settings.idle_after_minutes + settings.idle_repeat_minutes
        }
    elif kind == KIND_HOURLY:
        detail = {"hour": now_local.hour}
    elif kind == KIND_READY:
        detail = {
            "new_ready": settings.ready_min_units,
            "ready_total": snapshot.ready_now_count,
        }
    # 预览也要带上"距上次复习多久"，否则样例看起来比真实推送温柔。
    activity = read_activity(
        s, study_day_of(now_local, zone), now=now_utc
    )
    since_last_minutes = (
        int((now_utc - activity.last_activity_at).total_seconds() // 60)
        if activity.last_activity_at is not None
        else 0
    )
    message = compose(
        kind,
        settings,
        snapshot,
        detail,
        runtime_done_before=snapshot.completed_today,
        since_last_minutes=since_last_minutes,
    )
    result = send_bark(
        settings.bark_key,
        message.title,
        message.body,
        group=settings.bark_group,
        icon_url=settings.icon_url or None,
    )
    return {
        "ok": result.ok,
        "error": result.error,
        "kind": kind,
        "title": message.title,
        "body": message.body,
    }
