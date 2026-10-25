""""人现在就在操作"的心跳。

闲置提醒如果只认"评分/保存脑图"，你在手机上翻卡、点按钮、翻页都不算动作，
明明在学却一直被催。所以前端在真实交互（点击、按键、触摸）时打一个点。

三个刻意的取舍：

- **只认真实交互**，不认页面加载和后台轮询。Service Worker 每 60 秒拉一次
  `/release.json`，如果按"有请求就算活着"，闲置提醒永远不会响。
- **存在内存里**，不落库。这是秒级状态，写 SQLite 换不来任何好处；
  进程重启后最多多催一次，且下一次交互立刻纠正。
- **节流在前端**（默认 60 秒一次），后端只记最后一次时间。
"""

from __future__ import annotations

import threading
from datetime import datetime

from memory_anki.core.time import utc_now_naive

_LOCK = threading.Lock()
_LAST_SEEN: datetime | None = None


def mark_seen(now: datetime | None = None) -> datetime:
    global _LAST_SEEN
    moment = now or utc_now_naive()
    with _LOCK:
        if _LAST_SEEN is None or moment > _LAST_SEEN:
            _LAST_SEEN = moment
        return _LAST_SEEN


def last_seen() -> datetime | None:
    with _LOCK:
        return _LAST_SEEN


def reset() -> None:
    """测试用：清掉心跳。"""
    global _LAST_SEEN
    with _LOCK:
        _LAST_SEEN = None
