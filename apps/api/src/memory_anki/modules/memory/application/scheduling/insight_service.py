"""调度透明层 API 服务：今日任务详情、四键间隔预览、卡片"为什么是今天"、
参数负载模拟。只读（除 ensure_daily_plan 的幂等放出），供前端可视化。"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewDailyPlan,
    ReviewDailyPlanItem,
    ReviewNodeState,
)
from memory_anki.modules.memory.application.scheduling.daily_plan import (
    PLAN_SCOPE_PALACE,
    ensure_daily_plan,
)
from memory_anki.modules.memory.application.scheduling.kernel import (
    preview_intervals,
    preview_payload,
)
from memory_anki.modules.memory.application.wave_policy import local_date_of


def _palace_titles(session: Session, palace_ids: set[int]) -> dict[int, str]:
    if not palace_ids:
        return {}
    rows = session.query(Palace).filter(Palace.id.in_(palace_ids)).all()
    return {
        int(row.id): (row.manual_title or row.title or "未命名宫殿") for row in rows
    }


def today_plan_payload(session: Session) -> dict[str, Any]:
    """今日任务：全局摘要 + 按宫殿分组的进度 + 顺延明细。"""
    summary = ensure_daily_plan(session)
    local_day = local_date_of(utc_now_naive())
    plan = (
        session.query(ReviewDailyPlan)
        .filter(
            ReviewDailyPlan.local_date == local_day,
            ReviewDailyPlan.scope == PLAN_SCOPE_PALACE,
            ReviewDailyPlan.palace_id.is_(None),
        )
        .first()
    )
    palaces: list[dict[str, Any]] = []
    deferred_details: list[dict[str, Any]] = []
    if plan is not None:
        items = (
            session.query(ReviewDailyPlanItem)
            .filter(ReviewDailyPlanItem.plan_id == plan.id)
            .order_by(ReviewDailyPlanItem.position.asc())
            .all()
        )
        grouped: dict[int, dict[str, int]] = defaultdict(
            lambda: {
                "review_pending": 0,
                "review_done": 0,
                "review_deferred": 0,
                "new_pending": 0,
                "new_done": 0,
            }
        )
        for item in items:
            pid = int(item.palace_id or 0)
            bucket = grouped[pid]
            if item.kind == "review":
                if item.status == "done":
                    bucket["review_done"] += 1
                elif item.status == "deferred":
                    bucket["review_deferred"] += 1
                    node_uid = item.item_key.split(":", 1)[1] if ":" in item.item_key else item.item_key
                    deferred_details.append(
                        {
                            "palace_id": pid,
                            "node_uid": node_uid,
                            "defer_reason": item.defer_reason,
                        }
                    )
                else:
                    bucket["review_pending"] += 1
            else:
                if item.status == "done":
                    bucket["new_done"] += 1
                else:
                    bucket["new_pending"] += 1
        titles = _palace_titles(session, set(grouped))
        for pid, bucket in sorted(grouped.items()):
            palaces.append(
                {
                    "palace_id": pid,
                    "title": titles.get(pid, "未命名宫殿"),
                    **bucket,
                }
            )
        for detail in deferred_details:
            detail["palace_title"] = titles.get(int(detail["palace_id"]), "未命名宫殿")
    return {**summary, "palaces": palaces, "deferred_details": deferred_details}


def preview_intervals_payload(
    session: Session, *, items: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """批量四键间隔预览。未学过的节点按全新卡预览。"""
    from memory_anki.modules.memory.application.node_memory_projection import (
        _card_from_state,
        _card_id,
    )

    wanted: list[tuple[int, str]] = []
    for item in items[:200]:
        try:
            wanted.append((int(item["palace_id"]), str(item["node_uid"])))
        except (KeyError, TypeError, ValueError):
            continue
    if not wanted:
        return []
    palace_ids = {pid for pid, _ in wanted}
    states: dict[tuple[int, str], ReviewNodeState] = {
        (int(row.palace_id), row.node_uid): row
        for row in session.query(ReviewNodeState)
        .filter(ReviewNodeState.palace_id.in_(palace_ids))
        .all()
    }
    now = datetime.now(UTC)
    result = []
    for pid, uid in wanted:
        row = states.get((pid, uid))
        card = _card_from_state(row, card_id=_card_id(pid, uid))
        previews = preview_intervals(session, card=card, now=now)
        result.append(
            {
                "palace_id": pid,
                "node_uid": uid,
                "previews": preview_payload(previews),
            }
        )
    return result


def schedule_detail_payload(
    session: Session, *, palace_id: int, node_uid: str
) -> dict[str, Any]:
    """"为什么是今天"：S/D/R、上次复习、原定 vs 生效到期、挪动原因、四键预览。"""
    from memory_anki.modules.memory.application.node_memory_projection import (
        _card_from_state,
        _card_id,
        _scheduler,
    )
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        get_schedule_delta,
    )

    row = (
        session.query(ReviewNodeState)
        .filter_by(palace_id=palace_id, node_uid=node_uid)
        .first()
    )
    now = datetime.now(UTC)
    card = _card_from_state(row, card_id=_card_id(palace_id, node_uid))
    previews = preview_payload(preview_intervals(session, card=card, now=now))
    if row is None:
        return {
            "palace_id": palace_id,
            "node_uid": node_uid,
            "exists": False,
            "state": "backlog_new",
            "stability_days": None,
            "difficulty": None,
            "retrievability": None,
            "last_review_at": None,
            "raw_due_at": None,
            "effective_due_at": None,
            "shifted": False,
            "schedule_source": "backlog",
            "schedule_reason": "尚未放出：等待每日新学额度",
            "previews": previews,
        }
    scheduler = _scheduler(session)
    retrievability = (
        float(scheduler.get_card_retrievability(card, current_datetime=now))
        if row.last_review_at
        else None
    )
    delta = get_schedule_delta(row)
    return {
        "palace_id": palace_id,
        "node_uid": node_uid,
        "exists": True,
        "state": int(row.state),
        "stability_days": round(float(row.stability), 3) if row.stability else None,
        "difficulty": round(float(row.difficulty), 2) if row.difficulty else None,
        "retrievability": round(retrievability, 4) if retrievability is not None else None,
        "last_review_at": to_api_datetime(row.last_review_at) if row.last_review_at else None,
        "desired_retention": row.desired_retention,
        "parameter_version": row.parameter_version,
        **delta,
        "previews": previews,
    }


def simulate_load_payload(
    session: Session,
    *,
    desired_retention: float,
    days: int = 30,
) -> dict[str, Any]:
    """目标保持率调整的负载预览（解析近似：t ≈ 9·S·(1/R − 1)）。

    对每张有记忆的卡，用当前稳定度按新保持率重排到期日，与当前到期分布
    对比。近似公式与 FSRS 幂衰减在常用区间内一致，仅用于展示趋势。
    """
    days = max(7, min(int(days), 60))
    retention = min(0.99, max(0.70, float(desired_retention)))
    now = utc_now_naive()
    today = local_date_of(now)
    end = today + timedelta(days=days - 1)

    rows = (
        session.query(ReviewNodeState)
        .join(Palace, Palace.id == ReviewNodeState.palace_id)
        .filter(
            Palace.deleted_at.is_(None),
            Palace.archived == False,  # noqa: E712
            ReviewNodeState.last_review_at.is_not(None),
            ReviewNodeState.stability.is_not(None),
        )
        .all()
    )
    current: dict[str, int] = {}
    simulated: dict[str, int] = {}
    current_total = 0
    simulated_total = 0
    for row in rows:
        due = row.due_at
        if due is not None:
            day = max(local_date_of(due), today)
            if day <= end:
                key = day.isoformat()
                current[key] = current.get(key, 0) + 1
                current_total += 1
        stability = float(row.stability or 0.0)
        if stability <= 0:
            continue
        interval_days = 9.0 * stability * (1.0 / retention - 1.0)
        sim_due = row.last_review_at + timedelta(days=interval_days)
        sim_day = max(local_date_of(sim_due), today)
        if sim_day <= end:
            key = sim_day.isoformat()
            simulated[key] = simulated.get(key, 0) + 1
            simulated_total += 1
    items = []
    for offset in range(days):
        day = today + timedelta(days=offset)
        key = day.isoformat()
        items.append(
            {
                "date": key,
                "current_due": current.get(key, 0),
                "simulated_due": simulated.get(key, 0),
            }
        )
    return {
        "days": days,
        "desired_retention": retention,
        "current_total": current_total,
        "simulated_total": simulated_total,
        "items": items,
    }
