"""Bark 推送网关。

Bark 的协议就是一次 GET：``https://api.day.app/<key>/<标题>/<正文>``。
正文放在路径段里，所以必须逐段 URL 编码——标题里的 ``/`` 或 ``?``
否则会把请求拆成另一个地址。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import requests  # type: ignore[import-untyped]

from memory_anki.modules.reminders.domain.schemas import DEFAULT_BARK_GROUP

logger = logging.getLogger(__name__)

BARK_BASE_URL = "https://api.day.app"
DEFAULT_TIMEOUT_SECONDS = 10.0
# 通知在手机上保留 6 小时；过期后点开意义不大。
DEFAULT_TTL_SECONDS = 6 * 60 * 60


@dataclass(frozen=True)
class BarkResult:
    ok: bool
    http_status: int | None
    error: str = ""


def build_bark_url(
    bark_key: str,
    title: str,
    body: str,
    *,
    group: str = DEFAULT_BARK_GROUP,
    notification_id: str | None = None,
    icon_url: str | None = None,
) -> str:
    key = quote(bark_key, safe="")
    query = f"group={quote(group, safe='')}&level=active&ttl={DEFAULT_TTL_SECONDS}"
    if notification_id:
        # iOS 15+ 同 id 的通知互相覆盖，而不是堆成一片。
        query += f"&id={quote(notification_id, safe='')}"
    if icon_url:
        # Bark 服务器会去下载这张图，所以它必须是公网地址。
        query += f"&icon={quote(icon_url, safe='')}"
    return (
        f"{BARK_BASE_URL}/{key}/{quote(title, safe='')}/{quote(body, safe='')}?{query}"
    )


def send_bark(
    bark_key: str,
    title: str,
    body: str,
    *,
    group: str = DEFAULT_BARK_GROUP,
    notification_id: str | None = None,
    icon_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> BarkResult:
    if not bark_key:
        return BarkResult(False, None, "bark key missing")
    url = build_bark_url(
        bark_key,
        title,
        body,
        group=group,
        notification_id=notification_id,
        icon_url=icon_url,
    )
    try:
        response = requests.get(url, timeout=timeout)
    except requests.Timeout:
        return BarkResult(False, None, "timeout")
    except requests.RequestException as exc:
        # Never log the URL: it contains the push key.
        logger.warning("bark request failed: %s", type(exc).__name__)
        return BarkResult(False, None, f"network error: {type(exc).__name__}")
    status = int(response.status_code)
    payload: Any
    try:
        payload = response.json()
    except ValueError:
        payload = None
    body_message = ""
    code = None
    if isinstance(payload, dict):
        body_message = str(payload.get("message") or "")[:200]
        code = payload.get("code")
    # Bark 的失败有两种形态：显式 4xx/5xx，以及 HTTP 200 但 body.code != 200
    # （错误设备 Key 走后者）。两种都把 Bark 自己的话带回设置页，
    # 否则用户只会看到一句"http 400"，不知道是 Key 过期还是网络问题。
    if status >= 400:
        return BarkResult(False, status, body_message or f"http {status}")
    if code is not None and int(code) != 200:
        return BarkResult(False, status, body_message or "bark rejected the request")
    return BarkResult(True, status, "")
