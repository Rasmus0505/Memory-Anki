"""复习提醒设置的持久化。

存到既有 ``config`` 表的一个键里，不新建 preferences 表：这是一份单例设置，
和 ``core.config.DEFAULTS`` 的播种机制同源，跨设备跟着数据库走。
Bark Key 等于手机推送密码，只在服务端保存原值，对外一律打码。
"""

from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.reminders.domain.schemas import ReminderSettings

logger = logging.getLogger(__name__)

SETTINGS_CONFIG_KEY = "reminders.settings"
_BARK_HOST_HINTS = ("api.day.app", "day.app")


def parse_bark_key(raw: Any) -> str:
    """接受整条 ``https://api.day.app/<key>/标题/正文`` 或裸 Key。

    用户手上通常只有整条 URL，直接粘进来就该能用。
    """
    text = str(raw or "").strip()
    if not text:
        return ""
    if "://" not in text and "/" not in text and "?" not in text:
        return text
    candidate = text if "://" in text else f"https://{text}"
    parsed = urlparse(candidate)
    segments = [segment for segment in parsed.path.split("/") if segment]
    if not segments:
        return ""
    host = parsed.netloc.lower()
    if any(hint in host for hint in _BARK_HOST_HINTS):
        return segments[0]
    # Not a Bark URL: keep the last path segment so a pasted query string cannot
    # become part of the key.
    return segments[-1]


def mask_bark_key(key: str) -> str:
    if not key:
        return ""
    tail = key[-4:] if len(key) > 4 else key
    return f"••••{tail}"


def _read_raw(session: Session) -> dict[str, Any]:
    row = session.query(Config).filter(Config.key == SETTINGS_CONFIG_KEY).first()
    if row is None or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
    except (TypeError, ValueError):
        logger.warning("reminders: unreadable settings JSON, falling back to defaults")
        return {}
    return payload if isinstance(payload, dict) else {}


def read_settings(session: Session) -> ReminderSettings:
    return ReminderSettings.from_payload(_read_raw(session))


def _write_raw(session: Session, payload: dict[str, Any]) -> None:
    row = session.query(Config).filter(Config.key == SETTINGS_CONFIG_KEY).first()
    text = json.dumps(payload, ensure_ascii=False)
    if row is None:
        session.add(Config(key=SETTINGS_CONFIG_KEY, value=text))
    else:
        row.value = text
    session.flush()


def update_settings(session: Session, changes: Any) -> ReminderSettings:
    """部分更新。

    ``bark_key`` 省略 = 保持原值（前端只拿到打码后的 Key）；
    显式传空字符串 = 清除。
    """
    current = _read_raw(session)
    incoming = changes if isinstance(changes, dict) else {}
    merged = {**current, **{k: v for k, v in incoming.items() if k != "bark_key"}}
    if "bark_key" in incoming:
        merged["bark_key"] = parse_bark_key(incoming.get("bark_key"))
    settings = ReminderSettings.from_payload(merged)
    _write_raw(session, {**settings.to_payload(), "bark_key": settings.bark_key})
    # 事务在应用层提交：presentation 不允许 commit（check_architecture 强制）。
    session.commit()
    return settings
