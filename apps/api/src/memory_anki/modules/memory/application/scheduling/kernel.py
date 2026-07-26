"""L1 调度内核：4 键间隔预览（纯 FSRS，无任何 clamp）。

评分写入本体在 node_memory_service.rate_nodes（同样纯 FSRS 直出）；
本模块提供只读预测，供评分按钮显示"按下去会怎样"。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from fsrs import Card, Rating
from sqlalchemy.orm import Session

from memory_anki.modules.memory.application.fsrs_runtime import (
    VALID_RATINGS,
    build_scheduler,
)


@dataclass(frozen=True)
class IntervalPreview:
    rating: int
    interval_seconds: int
    due_at: datetime  # aware UTC
    display: str
    resulting_state: int


def format_interval_display(interval: timedelta) -> str:
    """人类可读的间隔：<1时→分钟，<1天→小时，<30天→天，<365天→月，其余→年。"""
    seconds = max(0, int(interval.total_seconds()))
    if seconds < 3600:
        return f"{max(1, round(seconds / 60))}分钟"
    if seconds < 86400:
        return f"{round(seconds / 3600)}小时"
    days = interval.total_seconds() / 86400
    if days < 30:
        return f"{round(days)}天"
    if days < 365:
        months = days / 30.44
        return f"{months:.1f}".rstrip("0").rstrip(".") + "个月"
    years = days / 365.25
    return f"{years:.1f}".rstrip("0").rstrip(".") + "年"


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def preview_intervals(
    session: Session | None,
    *,
    card: Card,
    now: datetime | None = None,
) -> dict[int, IntervalPreview]:
    """对四个评分各模拟一次 review_card，返回下次间隔预测。

    预览必须确定性（按钮显示不能每次刷新都变），所以强制关 fuzzing；
    实际评分写入仍按配置走 fuzz。
    """
    review_now = _aware(now) or datetime.now(UTC)
    scheduler = build_scheduler(session, enable_fuzzing=False)
    previews: dict[int, IntervalPreview] = {}
    for rating in sorted(VALID_RATINGS):
        clone = Card.from_dict(card.to_dict())
        result, _log = scheduler.review_card(
            clone, Rating(rating), review_datetime=review_now
        )
        due_aware = _aware(result.due) or review_now
        interval = due_aware - review_now
        previews[rating] = IntervalPreview(
            rating=rating,
            interval_seconds=max(0, int(interval.total_seconds())),
            due_at=due_aware,
            display=format_interval_display(interval),
            resulting_state=int(result.state),
        )
    return previews


def preview_payload(previews: dict[int, IntervalPreview]) -> list[dict[str, Any]]:
    """API 序列化形态。"""
    return [
        {
            "rating": p.rating,
            "interval_seconds": p.interval_seconds,
            "due_at": p.due_at.isoformat(),
            "display": p.display,
            "resulting_state": p.resulting_state,
        }
        for p in previews.values()
    ]
