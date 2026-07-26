"""L2 每日任务层：新学/复习双额度、超额顺延标注、新卡按额度放出。

原则：本层不改任何 FSRS due（顺延只是队列级标注）；新卡"放出"即创建
ReviewNodeState 行，未放出的树节点没有行=backlog，不进入任何到期队列。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewDailyPlan,
    ReviewDailyPlanItem,
    ReviewNodeState,
)
from memory_anki.modules.memory.application.wave_policy import (
    SCHEDULE_CONSOLIDATE,
    SCHEDULE_CONTENT_CHANGED,
    SCHEDULE_REINFORCEMENT,
    local_date_of,
)

DEFAULT_DAILY_NEW_LIMIT = 20

PLAN_SCOPE_PALACE = "palace"
ITEM_KIND_REVIEW = "review"
ITEM_KIND_NEW = "new"
ITEM_KIND_CONSOLIDATE = "consolidate"
ITEM_PENDING = "pending"
ITEM_DONE = "done"
ITEM_DEFERRED = "deferred"

# 新卡放出时的 schedule_source：可进入正式队列（is_formal_queue_eligible
# 对 has_memory=False 一律 True），且能与"从未放出"区分。
SCHEDULE_DAILY_RELEASE = "new"


@dataclass(frozen=True)
class DailyQuota:
    """只剩新学额度。

    每日**复习**额度已删除：调度单位是宫殿整批，按卡片数截断会把刚拉齐的
    批次重新切碎（20 卡单元遇上剩余额度 5 → 被切成 3–4 天），正是碎片化的
    来源之一。到期就该复习；负载控制改为在**排期时**由 ``load_balance``
    避开拥挤的日子，而不是在当天截断。
    """

    new_limit: int
    source: str


def _read_int_config(session: Session, key: str, fallback: int) -> int:
    from memory_anki.infrastructure.db._tables.misc import Config

    row = session.query(Config).filter_by(key=key).first()
    try:
        return max(0, int(row.value)) if row is not None and row.value else fallback
    except (TypeError, ValueError):
        return fallback


def get_daily_quota(session: Session, *, palace_id: int | None = None) -> DailyQuota:
    new_limit = _read_int_config(session, "daily_new_limit", DEFAULT_DAILY_NEW_LIMIT)
    source = "global"
    if palace_id is not None:
        from memory_anki.modules.memory.application.scheduling.aggregation import (
            get_palace_review_settings,
        )

        settings = get_palace_review_settings(session, palace_id)
        if settings is not None and settings.daily_new_limit_override is not None:
            new_limit = max(0, int(settings.daily_new_limit_override))
            source = "palace_override"
    return DailyQuota(new_limit=new_limit, source=source)


def _item_key(palace_id: int, node_uid: str) -> str:
    return f"{palace_id}:{node_uid}"


def _local_day_bounds(local_day: date) -> tuple[datetime, datetime]:
    """[start, end) of the local calendar day, as UTC-naive storage datetimes."""
    from memory_anki.core.time import local_calendar_day_start_as_utc_naive

    start = local_calendar_day_start_as_utc_naive(local_day)
    end = local_calendar_day_start_as_utc_naive(local_day + timedelta(days=1))
    return start, end


def _get_or_create_plan(
    session: Session, *, local_day: date, quota: DailyQuota
) -> ReviewDailyPlan:
    plan = (
        session.query(ReviewDailyPlan)
        .filter(
            ReviewDailyPlan.local_date == local_day,
            ReviewDailyPlan.scope == PLAN_SCOPE_PALACE,
            ReviewDailyPlan.palace_id.is_(None),
        )
        .first()
    )
    now = utc_now_naive()
    if plan is None:
        plan = ReviewDailyPlan(
            id=f"plan-{uuid.uuid4()}",
            local_date=local_day,
            scope=PLAN_SCOPE_PALACE,
            palace_id=None,
            review_quota=0,  # 复习额度已删除；列保留为历史兼容
            new_quota=quota.new_limit,
            generated_at=now,
        )
        session.add(plan)
        session.flush()
    else:
        # 新学额度配置可能被用户改过：计划快照跟随最新配置。
        if plan.new_quota != quota.new_limit:
            plan.new_quota = quota.new_limit
        plan.regenerated_at = now
    return plan


def _due_today_rows(session: Session, *, day_end: datetime) -> list[ReviewNodeState]:
    """今天（本地日）到期或逾期、已有记忆的卡，按 due 升序。"""
    return (
        session.query(ReviewNodeState)
        .join(Palace, Palace.id == ReviewNodeState.palace_id)
        .filter(
            Palace.deleted_at.is_(None),
            Palace.archived == False,  # noqa: E712
            ReviewNodeState.due_at < day_end,
            ReviewNodeState.last_review_at.is_not(None),
        )
        .order_by(ReviewNodeState.due_at.asc(), ReviewNodeState.id.asc())
        .all()
    )


def _review_candidates(
    session: Session, *, day_end: datetime
) -> list[ReviewNodeState]:
    """进正式宫殿队列的到期卡（补刷/内容变更/巩固卡各走各的路）。"""
    return [
        row
        for row in _due_today_rows(session, day_end=day_end)
        if row.schedule_source
        not in {SCHEDULE_REINFORCEMENT, SCHEDULE_CONTENT_CHANGED, SCHEDULE_CONSOLIDATE}
    ]


def _consolidate_candidates(
    session: Session, *, day_end: datetime
) -> list[ReviewNodeState]:
    """今天到期的巩固卡：跨宫殿汇总，不唤醒任何宫殿会话。"""
    return [
        row
        for row in _due_today_rows(session, day_end=day_end)
        if row.schedule_source == SCHEDULE_CONSOLIDATE
    ]


def _release_new_cards(
    session: Session,
    plan: ReviewDailyPlan,
    items: dict[str, ReviewDailyPlanItem],
    *,
    quota: DailyQuota,
    palace_id: int | None,
    now: datetime,
) -> int:
    """按文档序放出 backlog 新卡（创建 state 行 + 计划项）。返回剩余 backlog 数。"""
    from memory_anki.modules.memory.application.node_memory_projection import _tree

    released_today = sum(1 for item in items.values() if item.kind == ITEM_KIND_NEW)
    remaining_global = max(0, quota.new_limit - released_today)

    query = session.query(Palace).filter(
        Palace.deleted_at.is_(None), Palace.archived == False  # noqa: E712
    )
    if palace_id is not None:
        query = query.filter(Palace.id == palace_id)
    palaces = query.order_by(Palace.id).all()
    if not palaces:
        return 0

    # 批量预取，保持队列路径 SELECT 数恒定（不随宫殿数 N+1）。
    palace_ids = [int(p.id) for p in palaces]
    existing_by_palace: dict[int, set[str]] = {pid: set() for pid in palace_ids}
    for pid, uid in (
        session.query(ReviewNodeState.palace_id, ReviewNodeState.node_uid)
        .filter(ReviewNodeState.palace_id.in_(palace_ids))
        .all()
    ):
        existing_by_palace.setdefault(int(pid), set()).add(uid)
    try:
        from memory_anki.infrastructure.db._tables.reviews import PalaceReviewSettings

        settings_by_palace = {
            int(row.palace_id): row
            for row in session.query(PalaceReviewSettings)
            .filter(PalaceReviewSettings.palace_id.in_(palace_ids))
            .all()
        }
    except Exception:
        settings_by_palace = {}

    backlog_remaining = 0
    position = len(items)
    for palace in palaces:
        root_uid, nodes = _tree(palace)
        existing_uids = existing_by_palace.get(int(palace.id), set())
        backlog_uids = [
            uid for uid in nodes if uid != root_uid and uid not in existing_uids
        ]
        if not backlog_uids:
            continue
        settings = settings_by_palace.get(int(palace.id))
        palace_cap: int | None = None
        if settings is not None and settings.daily_new_limit_override is not None:
            palace_released = sum(
                1
                for item in items.values()
                if item.kind == ITEM_KIND_NEW and item.palace_id == palace.id
            )
            palace_cap = max(0, int(settings.daily_new_limit_override) - palace_released)
        for uid in backlog_uids:
            if remaining_global <= 0 or (palace_cap is not None and palace_cap <= 0):
                backlog_remaining += 1
                continue
            fingerprint = nodes[uid]["content_fingerprint"]
            row = ReviewNodeState(
                palace_id=int(palace.id),
                node_uid=uid,
                state=1,
                due_at=now,
                raw_due_at=now,
                content_fingerprint=fingerprint,
                state_source="new",
                schedule_source=SCHEDULE_DAILY_RELEASE,
                schedule_reason="daily_new_release",
            )
            session.add(row)
            key = _item_key(int(palace.id), uid)
            item = ReviewDailyPlanItem(
                plan_id=plan.id,
                palace_id=int(palace.id),
                item_key=key,
                kind=ITEM_KIND_NEW,
                status=ITEM_PENDING,
                position=position,
            )
            session.add(item)
            items[key] = item
            position += 1
            remaining_global -= 1
            if palace_cap is not None:
                palace_cap -= 1
    session.flush()
    return backlog_remaining


def ensure_daily_plan(
    session: Session,
    *,
    now: datetime | None = None,
    palace_id: int | None = None,
) -> dict[str, Any]:
    """幂等生成/刷新今天的任务账本，返回摘要视图。

    - 复习项：今天到期+逾期的卡**全部** pending，**不再有额度截断与顺延**。
      账本的价值是给进度条一个稳定的分母（到期数会随着复习被重排走而变化）。
    - 巩固项：今天到期的短间隔/掉队卡，跨宫殿汇总，不唤醒宫殿会话。
    - 新学项：backlog 按（宫殿序, 文档序）放出，受全局与宫殿覆盖额度约束。
    - palace_id 仅约束"本次放出哪个宫殿的新卡"，复习账本始终是全局的。
    """
    now_naive = now or utc_now_naive()
    local_day = local_date_of(now_naive)
    _, day_end = _local_day_bounds(local_day)
    quota = get_daily_quota(session)
    plan = _get_or_create_plan(session, local_day=local_day, quota=quota)
    items: dict[str, ReviewDailyPlanItem] = {
        item.item_key: item
        for item in session.query(ReviewDailyPlanItem)
        .filter(ReviewDailyPlanItem.plan_id == plan.id)
        .all()
    }

    backlog_remaining = _release_new_cards(
        session, plan, items, quota=quota, palace_id=palace_id, now=now_naive
    )

    position = 0
    now_ts = utc_now_naive()
    for kind, rows in (
        (ITEM_KIND_CONSOLIDATE, _consolidate_candidates(session, day_end=day_end)),
        (ITEM_KIND_REVIEW, _review_candidates(session, day_end=day_end)),
    ):
        for row in rows:
            key = _item_key(int(row.palace_id), row.node_uid)
            item = items.get(key)
            if item is None:
                item = ReviewDailyPlanItem(
                    plan_id=plan.id,
                    palace_id=int(row.palace_id),
                    item_key=key,
                    kind=kind,
                    status=ITEM_PENDING,
                    position=position,
                )
                session.add(item)
                items[key] = item
            elif item.status != ITEM_DONE:
                # 卡可能在两类之间迁移（差卡进巩固、恢复后并回宫殿波次）。
                item.kind = kind
                item.status = ITEM_PENDING
                item.defer_reason = None
                item.position = position
                item.updated_at = now_ts
            position += 1
    session.flush()
    return summarize_plan(
        plan, items.values(), backlog_remaining=backlog_remaining
    )


def summarize_plan(
    plan: ReviewDailyPlan,
    items: Any,
    *,
    backlog_remaining: int = 0,
) -> dict[str, Any]:
    counts = {
        kind: {"pending": 0, "done": 0}
        for kind in (ITEM_KIND_REVIEW, ITEM_KIND_NEW, ITEM_KIND_CONSOLIDATE)
    }
    for item in items:
        bucket = counts.get(item.kind)
        if bucket is None:
            continue
        bucket["done" if item.status == ITEM_DONE else "pending"] += 1
    pending_total = sum(bucket["pending"] for bucket in counts.values())
    return {
        "local_date": plan.local_date.isoformat(),
        "new_quota": plan.new_quota,
        "review_pending": counts[ITEM_KIND_REVIEW]["pending"],
        "review_done": counts[ITEM_KIND_REVIEW]["done"],
        "new_pending": counts[ITEM_KIND_NEW]["pending"],
        "new_done": counts[ITEM_KIND_NEW]["done"],
        "consolidate_pending": counts[ITEM_KIND_CONSOLIDATE]["pending"],
        "consolidate_done": counts[ITEM_KIND_CONSOLIDATE]["done"],
        "backlog_new": backlog_remaining,
        "completed": pending_total == 0,
    }


def record_plan_progress(
    session: Session,
    *,
    palace_id: int,
    node_uid: str,
    reviewed_at: datetime | None = None,
) -> None:
    """评分后回写计划完成态。计划外评分（提前复习等）静默忽略。"""
    at = reviewed_at or utc_now_naive()
    local_day = local_date_of(at)
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
        return
    item = (
        session.query(ReviewDailyPlanItem)
        .filter(
            ReviewDailyPlanItem.plan_id == plan.id,
            ReviewDailyPlanItem.item_key == _item_key(palace_id, node_uid),
        )
        .first()
    )
    if item is None or item.status == ITEM_DONE:
        return
    item.status = ITEM_DONE
    item.defer_reason = None
    item.rated_at = at
    item.updated_at = at


def deferred_item_keys_for_today(
    session: Session, *, now: datetime | None = None
) -> set[str]:
    """今天被顺延的卡 key 集合（正式队列/冻结集用来排除）。"""
    local_day = local_date_of(now or utc_now_naive())
    rows = (
        session.query(ReviewDailyPlanItem.item_key)
        .join(ReviewDailyPlan, ReviewDailyPlan.id == ReviewDailyPlanItem.plan_id)
        .filter(
            ReviewDailyPlan.local_date == local_day,
            ReviewDailyPlan.scope == PLAN_SCOPE_PALACE,
            ReviewDailyPlan.palace_id.is_(None),
            ReviewDailyPlanItem.status == ITEM_DEFERRED,
        )
        .all()
    )
    return {row[0] for row in rows}


def get_today_summary(
    session: Session, *, now: datetime | None = None
) -> dict[str, Any]:
    return ensure_daily_plan(session, now=now)
