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
                "new_pending": 0,
                "new_done": 0,
                "consolidate_pending": 0,
                "consolidate_done": 0,
            }
        )
        for item in items:
            pid = int(item.palace_id or 0)
            bucket = grouped[pid]
            key = f"{item.kind}_{'done' if item.status == 'done' else 'pending'}"
            if key in bucket:
                bucket[key] += 1
        titles = _palace_titles(session, set(grouped))
        for pid, bucket in sorted(grouped.items()):
            palaces.append(
                {
                    "palace_id": pid,
                    "title": titles.get(pid, "未命名宫殿"),
                    **bucket,
                }
            )
    return {**summary, "palaces": palaces}


def consolidate_today_payload(session: Session) -> dict[str, Any]:
    """今日巩固：跨宫殿的短间隔/掉队卡，一个统一清单几张快速刷完。

    这些卡不唤醒任何宫殿会话——一张差卡把整个宫殿拖成高频小批次，正是
    碎片化最典型的路径。排序：宫殿按最早 due，宫殿内按导图 DFS 先序。
    """
    from memory_anki.modules.memory.application.node_memory_projection import (
        _card_from_state,
        _card_id,
        _tree,
    )
    from memory_anki.modules.memory.application.scheduling.daily_plan import (
        ITEM_KIND_CONSOLIDATE,
        ensure_daily_plan,
    )
    from memory_anki.modules.memory.application.scheduling.units import unit_of_node
    from memory_anki.modules.mindmap_document.api import ancestor_path

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
    if plan is None:
        return {"local_date": local_day.isoformat(), "total": 0, "pending": 0, "done": 0, "items": []}

    plan_items = (
        session.query(ReviewDailyPlanItem)
        .filter(
            ReviewDailyPlanItem.plan_id == plan.id,
            ReviewDailyPlanItem.kind == ITEM_KIND_CONSOLIDATE,
        )
        .all()
    )
    pending_keys = {
        item.item_key for item in plan_items if item.status != "done"
    }
    palace_ids = {int(item.palace_id) for item in plan_items if item.palace_id}
    if not pending_keys or not palace_ids:
        return {
            "local_date": local_day.isoformat(),
            "total": len(plan_items),
            "pending": len(pending_keys),
            "done": len(plan_items) - len(pending_keys),
            "items": [],
        }

    states = {
        (int(row.palace_id), row.node_uid): row
        for row in session.query(ReviewNodeState)
        .filter(ReviewNodeState.palace_id.in_(palace_ids))
        .all()
    }
    palaces = {
        int(row.id): row
        for row in session.query(Palace).filter(Palace.id.in_(palace_ids)).all()
    }
    now = datetime.now(UTC)
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for palace_id, palace in palaces.items():
        _root, nodes = _tree(palace)
        order = {uid: index for index, uid in enumerate(nodes)}
        for key in pending_keys:
            prefix, _, node_uid = key.partition(":")
            if prefix != str(palace_id) or node_uid not in nodes:
                continue
            row = states.get((palace_id, node_uid))
            if row is None:
                continue
            card = _card_from_state(row, card_id=_card_id(palace_id, node_uid))
            unit = unit_of_node(session, palace_id, node_uid)
            grouped[palace_id].append(
                {
                    "_order": order.get(node_uid, 0),
                    "_due": row.due_at,
                    "palace_id": palace_id,
                    "palace_title": palace.manual_title or palace.title or "未命名宫殿",
                    "unit_title": (unit.title if unit and unit.kind == "mark" else ""),
                    "node_uid": node_uid,
                    "text": str(nodes[node_uid].get("text") or ""),
                    "context_path": ancestor_path(nodes, node_uid),
                    "state": int(row.state),
                    "interval_days": (
                        round((row.due_at - row.last_review_at).total_seconds() / 86400, 2)
                        if row.last_review_at and row.due_at
                        else None
                    ),
                    "raw_due_at": to_api_datetime(row.raw_due_at) if row.raw_due_at else None,
                    "schedule_reason": row.schedule_reason,
                    "previews": preview_payload(
                        preview_intervals(session, card=card, now=now)
                    ),
                }
            )
    items: list[dict[str, Any]] = []
    for palace_id in sorted(
        grouped,
        key=lambda pid: min(
            (entry["_due"] for entry in grouped[pid] if entry["_due"]), default=now
        ),
    ):
        for entry in sorted(grouped[palace_id], key=lambda e: e["_order"]):
            entry.pop("_order", None)
            entry.pop("_due", None)
            items.append(entry)
    return {
        "local_date": local_day.isoformat(),
        "total": len(plan_items),
        "pending": summary.get("consolidate_pending", len(pending_keys)),
        "done": summary.get("consolidate_done", 0),
        "items": items,
    }


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
