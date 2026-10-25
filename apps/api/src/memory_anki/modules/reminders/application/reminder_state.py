"""当天运行态。

存在 ``config`` 的独立键里，和用户设置分开：
设置是"你想要什么"，运行态是"今天已经发生过什么"。
两者混写会让前端保存设置时把轮次计数冲掉。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.reminders.domain.schemas import ReminderRuntime

logger = logging.getLogger(__name__)

RUNTIME_CONFIG_KEY = "reminders.runtime"


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def read_runtime(session: Session) -> ReminderRuntime:
    row = session.query(Config).filter(Config.key == RUNTIME_CONFIG_KEY).first()
    if row is None or not row.value:
        return ReminderRuntime()
    try:
        payload = json.loads(row.value)
    except (TypeError, ValueError):
        logger.warning("reminders: unreadable runtime state, starting fresh")
        return ReminderRuntime()
    if not isinstance(payload, dict):
        return ReminderRuntime()
    return ReminderRuntime(
        study_day=str(payload.get("study_day") or ""),
        idle_last_at=_parse_dt(payload.get("idle_last_at")),
        idle_repeats=int(payload.get("idle_repeats") or 0),
        ready_baseline=(
            int(payload["ready_baseline"])
            if payload.get("ready_baseline") is not None
            else None
        ),
        last_ready_at=_parse_dt(payload.get("last_ready_at")),
        last_hour_key=str(payload.get("last_hour_key") or ""),
        last_activity_at=_parse_dt(payload.get("last_activity_at")),
        last_hour_done=int(payload.get("last_hour_done") or 0),
    )


def write_runtime(session: Session, runtime: ReminderRuntime) -> None:
    payload = {
        "study_day": runtime.study_day,
        "idle_last_at": runtime.idle_last_at.isoformat() if runtime.idle_last_at else None,
        "idle_repeats": runtime.idle_repeats,
        "ready_baseline": runtime.ready_baseline,
        "last_ready_at": runtime.last_ready_at.isoformat() if runtime.last_ready_at else None,
        "last_hour_key": runtime.last_hour_key,
        "last_activity_at": (
            runtime.last_activity_at.isoformat() if runtime.last_activity_at else None
        ),
        "last_hour_done": runtime.last_hour_done,
    }
    row = session.query(Config).filter(Config.key == RUNTIME_CONFIG_KEY).first()
    text = json.dumps(payload, ensure_ascii=False)
    if row is None:
        session.add(Config(key=RUNTIME_CONFIG_KEY, value=text))
    else:
        row.value = text
    session.flush()
