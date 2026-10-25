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
from memory_anki.modules.reminders.application.due_summary import read_due_snapshot
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
    kind = str((data or {}).get("kind") or "").strip()
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail=f"unknown reminder kind: {kind}")
    settings = read_settings(s)
    if not settings.configured:
        return {"ok": False, "error": "尚未填写 Bark Key"}

    zone = resolve_local_timezone()
    now_local = datetime.now(zone)
    now_utc = now_local.astimezone(UTC).replace(tzinfo=None)
    snapshot = read_due_snapshot(
        s,
        study_day_of(now_local, zone),
        now=now_utc,
        include_streak=kind == KIND_HOURLY,
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
    message = compose(
        kind,
        settings,
        snapshot,
        detail,
        runtime_done_before=snapshot.completed_today,
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
