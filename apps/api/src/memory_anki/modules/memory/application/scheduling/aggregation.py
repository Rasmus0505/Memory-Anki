"""L3 可选聚合层：把容忍窗内的卡聚到同宫殿的集中复习日。

默认关闭（FSRS 直出）。开启后每次挪动都留痕（schedule_reason 记录
原定日期、生效日期与保持率损失），raw_due_at 永不改写，可随时清除还原。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.reviews import (
    PalaceReviewSettings,
    ReviewNodeState,
)
from memory_anki.modules.memory.application.wave_policy import (
    DEFAULT_AGGREGATION_POLICY,
    SCHEDULE_REINFORCEMENT,
    SCHEDULE_WAVE_ADSORB,
    AggregationPolicy,
    effective_due_at_for_local_date,
    interval_days,
    local_date_of,
    retention_drop_pp,
    retention_ok_for_later,
    safety_window_bounds,
)


def get_palace_review_settings(
    session: Session, palace_id: int
) -> PalaceReviewSettings | None:
    try:
        return session.get(PalaceReviewSettings, palace_id)
    except Exception:
        # 迁移 0047 之前表不存在：一律按默认（聚合关闭）。
        return None


def aggregation_enabled(session: Session, palace_id: int) -> bool:
    settings = get_palace_review_settings(session, palace_id)
    return bool(settings.aggregation_enabled) if settings is not None else False


def aggregation_policy_for(settings: PalaceReviewSettings | None) -> AggregationPolicy:
    if settings is None:
        return DEFAULT_AGGREGATION_POLICY
    base = DEFAULT_AGGREGATION_POLICY
    return AggregationPolicy(
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
        max_shift_ratio=base.max_shift_ratio,
        max_retention_drop=base.max_retention_drop,
    )


def upsert_palace_review_settings(
    session: Session,
    palace_id: int,
    *,
    aggregation_enabled: bool | None = None,
    aggregation_max_pull_days: int | None | object = ...,
    aggregation_max_push_days: int | None | object = ...,
    daily_new_limit_override: int | None | object = ...,
    daily_review_limit_override: int | None | object = ...,
) -> PalaceReviewSettings:
    row = session.get(PalaceReviewSettings, palace_id)
    if row is None:
        row = PalaceReviewSettings(palace_id=palace_id)
        session.add(row)
    if aggregation_enabled is not None:
        row.aggregation_enabled = bool(aggregation_enabled)
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
    session: Session, palace_id: int, *, today: date, horizon_days: int
) -> list[ReviewNodeState]:
    horizon_end = today + timedelta(days=horizon_days)
    rows = (
        session.query(ReviewNodeState)
        .filter(
            ReviewNodeState.palace_id == palace_id,
            ReviewNodeState.raw_due_at.is_not(None),
            ReviewNodeState.stability.is_not(None),
        )
        .all()
    )
    eligible = []
    for row in rows:
        if row.schedule_source == SCHEDULE_REINFORCEMENT:
            continue
        raw_local = local_date_of(row.raw_due_at)
        # 今天及过期的卡不聚合（它们本来就该现在复习）。
        if raw_local <= today or raw_local > horizon_end:
            continue
        eligible.append(row)
    return eligible


def compute_aggregation(
    session: Session,
    *,
    palace_id: int,
    horizon_days: int = 30,
    policy: AggregationPolicy | None = None,
    now: datetime | None = None,
) -> AggregationPreview:
    """贪心聚簇：反复选覆盖卡数最多的质心日，把容忍窗内的卡聚过去。"""
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

    unassigned = {row.node_uid: row for row in rows}
    assignment: dict[str, date] = {}
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
                    policy=active_policy,
                )
                if ok:
                    coverage.setdefault(day, []).append(uid)
                day += timedelta(days=1)
        if not coverage:
            break
        centroid, members = max(
            coverage.items(), key=lambda kv: (len(kv[1]), -kv[0].toordinal())
        )
        for uid in members:
            assignment[uid] = centroid
            unassigned.pop(uid, None)

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
