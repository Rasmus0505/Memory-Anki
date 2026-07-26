"""L3 可选聚合层：把容忍窗内的卡聚到同宫殿的集中复习日。

默认关闭（FSRS 直出）。开启后每次挪动都留痕（schedule_reason 记录
原定日期、生效日期与保持率损失），raw_due_at 永不改写，可随时清除还原。
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.reviews import (
    PalaceReviewSettings,
    ReviewNodeState,
)
from memory_anki.modules.memory.application.wave_policy import (
    DEFAULT_AGGREGATION_POLICY,
    DEFAULT_UNIT_DAY_POLICY,
    SCHEDULE_CONSOLIDATE,
    SCHEDULE_REINFORCEMENT,
    SCHEDULE_WAVE_ADSORB,
    UNIT_DAY_POLICY_FUZZ,
    UNIT_DAY_POLICY_LOAD_BALANCE,
    AggregationPolicy,
    effective_due_at_for_local_date,
    interval_days,
    local_date_of,
    retention_drop_pp,
    retention_ok_for_later,
    safety_window_bounds,
    unit_day_offset,
    unit_fuzz_spread_days,
)


def get_palace_review_settings(
    session: Session, palace_id: int
) -> PalaceReviewSettings | None:
    try:
        return session.get(PalaceReviewSettings, palace_id)
    except Exception:
        # 迁移 0047 之前表不存在：一律按默认（聚合关闭）。
        return None


DEFAULT_SCHEDULING_UNIT_MODE = "unit"


def _global_unit_mode(session: Session) -> str:
    from memory_anki.infrastructure.db._tables.misc import Config

    try:
        row = session.query(Config).filter_by(key="scheduling_unit_mode").first()
    except Exception:
        return DEFAULT_SCHEDULING_UNIT_MODE
    value = str(row.value).strip().lower() if row is not None and row.value else ""
    return value if value in {"unit", "card"} else DEFAULT_SCHEDULING_UNIT_MODE


def unit_mode_for(session: Session, palace_id: int) -> str:
    """'unit'（宫殿整批调度，默认）| 'card'（逐卡 FSRS 直出，逃生舱）。

    优先级：宫殿显式覆盖（``scheduling_unit_mode_override``）> 全局配置 >
    默认整批。旧的 ``aggregation_enabled`` 只在为真时视为"显式整批"——
    它的历史默认值 0 表示"从未表态"，应当跟随全局而不是强制逐卡。
    """
    settings = get_palace_review_settings(session, palace_id)
    if settings is not None:
        override = str(settings.scheduling_unit_mode_override or "").strip().lower()
        if override in {"unit", "card"}:
            return override
        if settings.aggregation_enabled:
            return "unit"
    return _global_unit_mode(session)


def aggregation_enabled(session: Session, palace_id: int) -> bool:
    return unit_mode_for(session, palace_id) == "unit"


def aggregation_policy_for(settings: PalaceReviewSettings | None) -> AggregationPolicy:
    """宫殿级覆盖只调绝对天数兜底；比例与保持率预算是全局策略。"""
    if settings is None:
        return DEFAULT_AGGREGATION_POLICY
    base = DEFAULT_AGGREGATION_POLICY
    return replace(
        base,
        max_pull_days=(
            int(settings.aggregation_max_pull_days)
            if settings.aggregation_max_pull_days is not None
            else base.max_pull_days
        ),
        max_push_days=(
            int(settings.aggregation_max_push_days)
            if settings.aggregation_max_push_days is not None
            else base.max_push_days
        ),
    )


def upsert_palace_review_settings(
    session: Session,
    palace_id: int,
    *,
    aggregation_enabled: bool | None = None,
    scheduling_unit_mode_override: str | None | object = ...,
    aggregation_max_pull_days: int | None | object = ...,
    aggregation_max_push_days: int | None | object = ...,
    unit_min_wave_cards_override: int | None | object = ...,
    daily_new_limit_override: int | None | object = ...,
    daily_review_limit_override: int | None | object = ...,
) -> PalaceReviewSettings:
    row = session.get(PalaceReviewSettings, palace_id)
    if row is None:
        row = PalaceReviewSettings(palace_id=palace_id)
        session.add(row)
    if aggregation_enabled is not None:
        # 兼容旧端点：布尔开关映射到显式的单元模式覆盖。
        row.aggregation_enabled = bool(aggregation_enabled)
        row.scheduling_unit_mode_override = "unit" if aggregation_enabled else "card"
    if scheduling_unit_mode_override is not ...:
        value = scheduling_unit_mode_override
        row.scheduling_unit_mode_override = (
            str(value) if value in {"unit", "card"} else None
        )
    if unit_min_wave_cards_override is not ...:
        row.unit_min_wave_cards_override = unit_min_wave_cards_override  # type: ignore[assignment]
    if aggregation_max_pull_days is not ...:
        row.aggregation_max_pull_days = aggregation_max_pull_days  # type: ignore[assignment]
    if aggregation_max_push_days is not ...:
        row.aggregation_max_push_days = aggregation_max_push_days  # type: ignore[assignment]
    if daily_new_limit_override is not ...:
        row.daily_new_limit_override = daily_new_limit_override  # type: ignore[assignment]
    if daily_review_limit_override is not ...:
        row.daily_review_limit_override = daily_review_limit_override  # type: ignore[assignment]
    row.updated_at = utc_now_naive()
    session.flush()
    return row


@dataclass(frozen=True)
class AggregationMove:
    node_uid: str
    raw_due_local: date
    target_local: date
    retention_drop_pp: float


@dataclass(frozen=True)
class AggregationPreview:
    palace_id: int
    horizon_days: int
    moves: tuple[AggregationMove, ...]
    day_counts_before: dict[str, int]
    day_counts_after: dict[str, int]


def _eligible_rows(
    session: Session,
    palace_id: int,
    *,
    today: date,
    horizon_days: int,
    node_uids: frozenset[str] | None = None,
    policy: AggregationPolicy | None = None,
    now: datetime | None = None,
) -> list[ReviewNodeState]:
    """可参与聚簇的卡。

    排除项：补刷卡、已在巩固清单的卡、Learning/Relearning 态、间隔短于
    ``consolidate_floor_days`` 的卡——这些属于「今日巩固」的范畴，把它们
    塞进单元波次会让一张短间隔卡唤醒整个宫殿会话。
    """
    from fsrs import State

    active_policy = policy or DEFAULT_AGGREGATION_POLICY
    now_naive = now or utc_now_naive()
    horizon_end = today + timedelta(days=horizon_days)
    query = session.query(ReviewNodeState).filter(
        ReviewNodeState.palace_id == palace_id,
        ReviewNodeState.raw_due_at.is_not(None),
        ReviewNodeState.stability.is_not(None),
    )
    eligible = []
    for row in query.all():
        if node_uids is not None and row.node_uid not in node_uids:
            continue
        if row.schedule_source in {SCHEDULE_REINFORCEMENT, SCHEDULE_CONSOLIDATE}:
            continue
        if int(row.state or 0) in {int(State.Learning), int(State.Relearning)}:
            continue
        if (row.raw_due_at - now_naive) < timedelta(
            days=active_policy.consolidate_floor_days
        ):
            continue
        raw_local = local_date_of(row.raw_due_at)
        # 今天及过期的卡不聚合（它们本来就该现在复习）。
        if raw_local <= today or raw_local > horizon_end:
            continue
        eligible.append(row)
    return eligible


def scheduled_day_load(
    session: Session, *, exclude_palace_id: int | None = None
) -> dict[date, int]:
    """全局每日已排期卡数——``load_balance`` 选质心日时用来避开拥挤的日子。

    取消每日复习额度后，这是唯一的负载控制手段（决策 8）。
    """
    query = session.query(
        ReviewNodeState.effective_local_date, func.count(ReviewNodeState.id)
    ).filter(ReviewNodeState.effective_local_date.is_not(None))
    if exclude_palace_id is not None:
        query = query.filter(ReviewNodeState.palace_id != exclude_palace_id)
    return {
        day: int(count)
        for day, count in query.group_by(ReviewNodeState.effective_local_date).all()
        if day is not None
    }


def _greedy_clusters(
    rows: list[ReviewNodeState],
    windows: dict[str, tuple[date, date, date]],
    policy: AggregationPolicy,
) -> list[tuple[date, list[str]]]:
    """反复选覆盖卡数最多的质心日，把容忍窗内的卡聚过去。

    打平时选"总提前天数最少"的日子：提前复习永久削弱稳定度增益（约
    −18%/20%），推后只付一次性的保持率损失——两个方向不等价。
    """
    unassigned = {row.node_uid: row for row in rows}
    clusters: list[tuple[date, list[str]]] = []
    while unassigned:
        coverage: dict[date, list[str]] = {}
        for uid, row in unassigned.items():
            raw_local, earliest, latest = windows[uid]
            day = earliest
            while day <= latest:
                ok = day <= raw_local or retention_ok_for_later(
                    stability_days=row.stability,
                    desired_retention=float(row.desired_retention or 0.9),
                    raw_due_local=raw_local,
                    candidate_local=day,
                    last_review_at=row.last_review_at,
                    policy=policy,
                )
                if ok:
                    coverage.setdefault(day, []).append(uid)
                day += timedelta(days=1)
        if not coverage:
            break

        def _score(item: tuple[date, list[str]]) -> tuple[int, int, int]:
            day, members = item
            total_pull = sum(max(0, (windows[uid][0] - day).days) for uid in members)
            return (len(members), -total_pull, day.toordinal())

        centroid, members = max(coverage.items(), key=_score)
        clusters.append((centroid, list(members)))
        for uid in members:
            unassigned.pop(uid, None)
    return clusters


def compute_aggregation(
    session: Session,
    *,
    palace_id: int,
    horizon_days: int = 30,
    policy: AggregationPolicy | None = None,
    now: datetime | None = None,
) -> AggregationPreview:
    """宫殿级聚簇预览（旧接口，保留给宫殿设置里的手动聚合预览/应用）。"""
    settings = get_palace_review_settings(session, palace_id)
    active_policy = policy or aggregation_policy_for(settings)
    now_naive = now or utc_now_naive()
    today = local_date_of(now_naive)
    rows = _eligible_rows(session, palace_id, today=today, horizon_days=horizon_days)

    windows: dict[str, tuple[date, date, date]] = {}
    before_counts: dict[str, int] = {}
    for row in rows:
        raw_local = local_date_of(row.raw_due_at)
        iv = interval_days(row.last_review_at, row.raw_due_at)
        earliest, latest = safety_window_bounds(
            anchor=raw_local, interval_days_value=iv, policy=active_policy
        )
        earliest = max(earliest, today + timedelta(days=1))
        windows[row.node_uid] = (raw_local, earliest, latest)
        key = raw_local.isoformat()
        before_counts[key] = before_counts.get(key, 0) + 1

    assignment: dict[str, date] = {}
    for centroid, members in _greedy_clusters(rows, windows, active_policy):
        for uid in members:
            assignment[uid] = centroid

    moves: list[AggregationMove] = []
    after_counts: dict[str, int] = {}
    for row in rows:
        raw_local = windows[row.node_uid][0]
        target = assignment.get(row.node_uid, raw_local)
        after_counts[target.isoformat()] = after_counts.get(target.isoformat(), 0) + 1
        if target != raw_local:
            moves.append(
                AggregationMove(
                    node_uid=row.node_uid,
                    raw_due_local=raw_local,
                    target_local=target,
                    retention_drop_pp=round(
                        retention_drop_pp(
                            stability_days=row.stability,
                            raw_due_local=raw_local,
                            candidate_local=target,
                            last_review_at=row.last_review_at,
                        )
                        * 100,
                        2,
                    ),
                )
            )
    return AggregationPreview(
        palace_id=palace_id,
        horizon_days=horizon_days,
        moves=tuple(moves),
        day_counts_before=before_counts,
        day_counts_after=after_counts,
    )


def apply_aggregation(
    session: Session, *, palace_id: int, preview: AggregationPreview
) -> int:
    """按预览落库：due_at 挪到聚合日（本地日起点），raw_due_at 不动，全程留痕。"""
    from memory_anki.modules.memory.application.wave_service import (
        get_or_create_formal_wave,
    )

    states = {
        row.node_uid: row
        for row in session.query(ReviewNodeState)
        .filter(ReviewNodeState.palace_id == palace_id)
        .all()
    }
    now = utc_now_naive()
    applied = 0
    for move in preview.moves:
        row = states.get(move.node_uid)
        if row is None or row.raw_due_at is None:
            continue
        # 卡片状态若在预览后变化（重新评分/重刷），跳过该项。
        if local_date_of(row.raw_due_at) != move.raw_due_local:
            continue
        wave = get_or_create_formal_wave(session, palace_id, move.target_local)
        row.due_at = effective_due_at_for_local_date(move.target_local)
        row.effective_wave_id = wave.id
        row.effective_local_date = move.target_local
        row.schedule_source = SCHEDULE_WAVE_ADSORB
        row.schedule_reason = (
            f"aggregated raw={move.raw_due_local.isoformat()}"
            f" -> effective={move.target_local.isoformat()}"
            f" dR={move.retention_drop_pp:+.2f}pp"
        )
        row.updated_at = now
        applied += 1
    session.flush()
    return applied


def clear_aggregation(session: Session, *, palace_id: int) -> int:
    """关闭聚合/一键还原：due_at 回落 raw_due_at，清空波次归属。"""
    rows = (
        session.query(ReviewNodeState)
        .filter(
            ReviewNodeState.palace_id == palace_id,
            ReviewNodeState.schedule_source == SCHEDULE_WAVE_ADSORB,
            ReviewNodeState.raw_due_at.is_not(None),
        )
        .all()
    )
    now = utc_now_naive()
    cleared = 0
    for row in rows:
        from memory_anki.modules.memory.application.wave_service import (
            remove_node_from_open_waves,
        )

        remove_node_from_open_waves(session, row)
        row.due_at = row.raw_due_at
        row.effective_wave_id = None
        row.effective_local_date = None
        row.schedule_source = "manual"
        row.schedule_reason = "aggregation_cleared"
        row.updated_at = now
        cleared += 1
    session.flush()
    return cleared


@dataclass(frozen=True)
class PlannedWave:
    local_date: date
    node_uids: tuple[str, ...]
    avg_retention_drop_pp: float


@dataclass(frozen=True)
class UnitAggregationPreview:
    palace_id: int
    unit_root_uid: str
    horizon_days: int
    waves: tuple[PlannedWave, ...]
    consolidate_node_uids: tuple[str, ...]
    moves: tuple[AggregationMove, ...]
    day_counts_before: dict[str, int]
    day_counts_after: dict[str, int]


def _unit_day_policy(session: Session) -> str:
    from memory_anki.infrastructure.db._tables.misc import Config

    try:
        row = session.query(Config).filter_by(key="unit_day_policy").first()
    except Exception:
        return DEFAULT_UNIT_DAY_POLICY
    value = str(row.value).strip().lower() if row is not None and row.value else ""
    return (
        value
        if value in {UNIT_DAY_POLICY_LOAD_BALANCE, UNIT_DAY_POLICY_FUZZ, "none"}
        else DEFAULT_UNIT_DAY_POLICY
    )


def _place_cluster_day(
    *,
    centroid: date,
    members: list[str],
    windows: dict[str, tuple[date, date, date]],
    policy_name: str,
    day_load: dict[date, int],
    palace_id: int,
    unit_root_uid: str,
    median_interval: float,
) -> date:
    """给一簇卡挑最终复习日：整簇一起挪，不打散内部。

    可行区间 = 簇内每张卡安全窗的交集。质心按构造落在所有窗内，所以交集
    非空，两种策略都不会失败。
    """
    lo = max(windows[uid][1] for uid in members)
    hi = min(windows[uid][2] for uid in members)
    if hi < lo:
        return centroid
    if policy_name == "none":
        return centroid
    if policy_name == UNIT_DAY_POLICY_FUZZ:
        spread = unit_fuzz_spread_days(median_interval)
        offset = unit_day_offset(
            palace_id=palace_id,
            unit_root_uid=unit_root_uid,
            anchor=centroid,
            spread_days=spread,
            lo=(lo - centroid).days,
            hi=(hi - centroid).days,
        )
        return centroid + timedelta(days=offset)
    # load_balance：可行区间内选全局已排期最少的一天，打平取最接近质心。
    candidates: list[tuple[int, int, int]] = []
    day = lo
    while day <= hi:
        candidates.append(
            (day_load.get(day, 0), abs((day - centroid).days), day.toordinal())
        )
        day += timedelta(days=1)
    if not candidates:
        return centroid
    best = min(candidates)
    return date.fromordinal(best[2])


def compute_unit_aggregation(
    session: Session,
    *,
    palace_id: int,
    unit_root_uid: str,
    horizon_days: int = 120,
    policy: AggregationPolicy | None = None,
    now: datetime | None = None,
) -> UnitAggregationPreview:
    """单元级全局重聚类：把一个调度单元未来的到期日收敛成少数几个波次日。

    与逐卡吸附（``assign_node_to_formal_wave``）的区别：那是增量近似、结果
    依赖评分顺序；这个在结算时对整个单元做一次全局最优。

    小簇（< ``min_wave_cards``）一律解散进「今日巩固」清单——这条**涌现
    判据**同时覆盖了"孤立的 8 天卡落在 60 天单元里"和"整单元都在 5 天间隔"
    两种相反情形，任何固定阈值都做不到。
    """
    from memory_anki.modules.memory.application.scheduling.units import resolve_units

    settings = get_palace_review_settings(session, palace_id)
    active_policy = policy or aggregation_policy_for(settings)
    if settings is not None and settings.unit_min_wave_cards_override is not None:
        active_policy = replace(
            active_policy,
            min_wave_cards=max(1, int(settings.unit_min_wave_cards_override)),
        )
    now_naive = now or utc_now_naive()
    today = local_date_of(now_naive)

    unit = resolve_units(session, palace_id).get(unit_root_uid)
    node_uids = unit.node_uids if unit is not None else None
    rows = _eligible_rows(
        session,
        palace_id,
        today=today,
        horizon_days=horizon_days,
        node_uids=node_uids,
        policy=active_policy,
        now=now_naive,
    )

    windows: dict[str, tuple[date, date, date]] = {}
    before_counts: dict[str, int] = {}
    intervals: list[float] = []
    for row in rows:
        raw_local = local_date_of(row.raw_due_at)
        iv = interval_days(row.last_review_at, row.raw_due_at)
        intervals.append(iv)
        earliest, latest = safety_window_bounds(
            anchor=raw_local, interval_days_value=iv, policy=active_policy
        )
        earliest = max(earliest, today + timedelta(days=1))
        windows[row.node_uid] = (raw_local, earliest, latest)
        key = raw_local.isoformat()
        before_counts[key] = before_counts.get(key, 0) + 1

    clusters = _greedy_clusters(rows, windows, active_policy)

    policy_name = _unit_day_policy(session)
    day_load = (
        scheduled_day_load(session, exclude_palace_id=palace_id)
        if policy_name == UNIT_DAY_POLICY_LOAD_BALANCE
        else {}
    )
    median_interval = (
        sorted(intervals)[len(intervals) // 2] if intervals else 0.0
    )
    by_uid = {row.node_uid: row for row in rows}

    waves: list[PlannedWave] = []
    consolidate: list[str] = []
    moves: list[AggregationMove] = []
    after_counts: dict[str, int] = {}
    for centroid, members in clusters:
        if len(members) < active_policy.min_wave_cards:
            # 一张卡撑起一次宫殿会话，正是用户抱怨的原型 → 解散进巩固清单。
            consolidate.extend(members)
            continue
        target = _place_cluster_day(
            centroid=centroid,
            members=members,
            windows=windows,
            policy_name=policy_name,
            day_load=day_load,
            palace_id=palace_id,
            unit_root_uid=unit_root_uid,
            median_interval=median_interval,
        )
        drops: list[float] = []
        for uid in members:
            raw_local = windows[uid][0]
            after_counts[target.isoformat()] = after_counts.get(target.isoformat(), 0) + 1
            drop = round(
                retention_drop_pp(
                    stability_days=by_uid[uid].stability,
                    raw_due_local=raw_local,
                    candidate_local=target,
                    last_review_at=by_uid[uid].last_review_at,
                )
                * 100,
                2,
            )
            drops.append(drop)
            if target != raw_local:
                moves.append(
                    AggregationMove(
                        node_uid=uid,
                        raw_due_local=raw_local,
                        target_local=target,
                        retention_drop_pp=drop,
                    )
                )
        waves.append(
            PlannedWave(
                local_date=target,
                node_uids=tuple(members),
                avg_retention_drop_pp=round(sum(drops) / len(drops), 2) if drops else 0.0,
            )
        )
    return UnitAggregationPreview(
        palace_id=palace_id,
        unit_root_uid=unit_root_uid,
        horizon_days=horizon_days,
        waves=tuple(waves),
        consolidate_node_uids=tuple(consolidate),
        moves=tuple(moves),
        day_counts_before=before_counts,
        day_counts_after=after_counts,
    )


def apply_unit_aggregation(
    session: Session, *, palace_id: int, preview: UnitAggregationPreview
) -> int:
    """落库单元聚类结果。``raw_due_at`` 永不改写。"""
    from memory_anki.modules.memory.application.wave_service import (
        get_or_create_formal_wave,
    )

    states = {
        row.node_uid: row
        for row in session.query(ReviewNodeState)
        .filter(ReviewNodeState.palace_id == palace_id)
        .all()
    }
    now = utc_now_naive()
    applied = 0
    for wave_plan in preview.waves:
        wave = get_or_create_formal_wave(
            session,
            palace_id,
            wave_plan.local_date,
            unit_root_uid=preview.unit_root_uid,
        )
        effective = effective_due_at_for_local_date(wave_plan.local_date)
        for uid in wave_plan.node_uids:
            row = states.get(uid)
            if row is None or row.raw_due_at is None:
                continue
            raw_local = local_date_of(row.raw_due_at)
            row.due_at = effective
            row.effective_wave_id = wave.id
            row.effective_local_date = wave_plan.local_date
            row.schedule_source = SCHEDULE_WAVE_ADSORB
            row.schedule_reason = (
                f"unit_wave raw={raw_local.isoformat()}"
                f" -> effective={wave_plan.local_date.isoformat()}"
                f" dR={wave_plan.avg_retention_drop_pp:+.2f}pp"
                f" unit={preview.unit_root_uid}"
            )
            row.updated_at = now
            applied += 1
    for uid in preview.consolidate_node_uids:
        row = states.get(uid)
        if row is None or row.raw_due_at is None:
            continue
        route_to_consolidation(session, row, reason="small_cluster", now=now)
        applied += 1
    session.flush()
    return applied


def route_to_consolidation(
    session: Session,
    row: ReviewNodeState,
    *,
    reason: str,
    now: datetime | None = None,
) -> None:
    """把一张卡交给跨宫殿「今日巩固」清单：不建宫殿波次、不挪到期日。"""
    from memory_anki.modules.memory.application.wave_service import (
        remove_node_from_open_waves,
    )

    at = now or utc_now_naive()
    remove_node_from_open_waves(session, row)
    if row.raw_due_at is not None:
        row.due_at = row.raw_due_at
    row.effective_wave_id = None
    row.effective_local_date = None
    row.schedule_source = SCHEDULE_CONSOLIDATE
    row.schedule_reason = f"consolidate:{reason}"
    row.updated_at = at


def get_schedule_delta(row: ReviewNodeState) -> dict:
    """"为什么是今天"面板数据：原定 vs 生效到期与挪动原因。"""
    raw = row.raw_due_at
    effective = row.due_at
    shifted = bool(
        raw is not None
        and effective is not None
        and local_date_of(raw) != local_date_of(effective)
    )
    return {
        "raw_due_at": raw.isoformat() if raw else None,
        "effective_due_at": effective.isoformat() if effective else None,
        "shifted": shifted,
        "schedule_source": row.schedule_source,
        "schedule_reason": row.schedule_reason,
    }
