"""Palace review wave lifecycle and schedule adsorption."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewWave,
    ReviewWaveItem,
)
from memory_anki.modules.memory.application.wave_policy import (
    ITEM_DONE,
    ITEM_PENDING,
    ITEM_PENDING_REINFORCEMENT,
    ITEM_RATED_DIRECT,
    ITEM_RATED_INHERITED,
    SCHEDULE_CONTENT_CHANGED,
    SCHEDULE_MANUAL,
    SCHEDULE_PRACTICE,
    SCHEDULE_REINFORCEMENT,
    SCHEDULE_UNINITIALIZED,
    SCHEDULE_WAVE_ADSORB,
    WAVE_STATUS_ACTIVE,
    WAVE_STATUS_PAUSED,
    WAVE_STATUS_SCHEDULED,
    WAVE_TYPE_FORMAL,
    WAVE_TYPE_REINFORCEMENT,
    WaveCandidate,
    effective_due_at_for_local_date,
    interval_days,
    local_date_of,
    pick_adsorb_wave,
    reinforcement_delay_minutes,
)
from memory_anki.modules.memory.application.wave_queries import (
    find_active_formal_wave,
    formal_due_node_uids,
    frozen_node_uids,
    get_wave_detail,
    list_palace_waves,
    wave_progress,
)
from memory_anki.modules.memory.application.wave_registry import (
    close_empty_open_wave,
    formal_candidates,
    get_or_create_formal_wave,
    get_or_create_reinforcement_wave,
    load_reinforcement_settings,
)
from memory_anki.modules.memory.application.wave_registry import (
    ensure_item as _ensure_item,
)
from memory_anki.modules.memory.application.wave_registry import (
    now_naive as _now,
)
from memory_anki.modules.memory.application.wave_registry import (
    recount_wave as _recount_wave,
)
from memory_anki.modules.memory.application.wave_registry import (
    sync_active_session_scope as _sync_active_session_scope,
)
from memory_anki.modules.memory.application.wave_session_service import (
    complete_formal_wave,
    pause_formal_wave,
    resume_formal_wave,
    start_reinforcement_wave_session,
)

# Re-export read helpers so existing imports of wave_service stay stable.
__all__ = [
    "apply_rating_to_schedule",
    "assign_node_to_formal_wave",
    "assign_node_to_reinforcement",
    "close_empty_open_wave",
    "complete_formal_wave",
    "find_active_formal_wave",
    "formal_candidates",
    "formal_due_node_uids",
    "frozen_node_uids",
    "get_or_create_formal_wave",
    "get_or_create_reinforcement_wave",
    "get_wave_detail",
    "list_palace_waves",
    "load_reinforcement_settings",
    "mark_content_changed",
    "mark_uninitialized",
    "mark_wave_item_rated",
    "merge_new_due_into_wave",
    "pause_formal_wave",
    "reconcile_rating_undo",
    "remove_node_from_open_waves",
    "resume_formal_wave",
    "start_formal_wave",
    "start_reinforcement_wave_session",
    "wave_progress",
]


def resolve_unit_root_uid(session: Session, palace_id: int, node_uid: str) -> str | None:
    """该节点所属调度单元的键（无标记时即宫殿根 uid）。"""
    from memory_anki.modules.memory.application.scheduling.units import (
        default_unit_root_uid,
        unit_root_uid_of_node,
    )

    return unit_root_uid_of_node(session, palace_id, node_uid) or default_unit_root_uid(
        session, palace_id
    )


def assign_node_to_formal_wave(
    session: Session,
    row: ReviewNodeState,
    *,
    raw_due_at: datetime,
    reason: str,
    desired_retention: float | None = None,
    force_new_day: date | None = None,
    unit_root_uid: str | None = None,
) -> ReviewWave:
    """Adsorb a node into the nearest safe wave **of its own unit**.

    吸附只在同一调度单元内发生——单元是"一次复习安排"的原子，跨单元吸附会
    把本该独立的两批卡搅在一起。
    """
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        aggregation_policy_for,
        get_palace_review_settings,
    )

    unit_uid = unit_root_uid or resolve_unit_root_uid(
        session, row.palace_id, row.node_uid
    )
    remove_node_from_open_waves(session, row)
    raw_local = local_date_of(raw_due_at)
    target_day = force_new_day or raw_local
    candidates = formal_candidates(session, row.palace_id, unit_root_uid=unit_uid)
    picked: WaveCandidate | None = None
    if force_new_day is None:
        iv = interval_days(row.last_review_at, raw_due_at)
        picked = pick_adsorb_wave(
            raw_due_local=raw_local,
            interval_days_value=iv,
            candidates=candidates,
            stability_days=row.stability,
            desired_retention=float(desired_retention or row.desired_retention or 0.9),
            last_review_at=row.last_review_at,
            policy=aggregation_policy_for(get_palace_review_settings(session, row.palace_id)),
            today=local_date_of(_now()),
        )
    if picked is not None:
        wave = session.get(ReviewWave, picked.wave_id)
        if wave is None:
            wave = get_or_create_formal_wave(
                session, row.palace_id, target_day, unit_root_uid=unit_uid
            )
        schedule_reason = f"adsorb_existing:{reason}"
        schedule_source = SCHEDULE_WAVE_ADSORB
    else:
        wave = get_or_create_formal_wave(
            session, row.palace_id, target_day, unit_root_uid=unit_uid
        )
        schedule_reason = f"new_wave:{reason}"
        schedule_source = SCHEDULE_WAVE_ADSORB if reason != "manual" else SCHEDULE_MANUAL

    assert wave.local_date is not None
    effective = effective_due_at_for_local_date(wave.local_date)
    row.raw_due_at = raw_due_at
    row.due_at = effective
    row.effective_wave_id = wave.id
    row.effective_local_date = wave.local_date
    row.schedule_source = schedule_source if reason != "practice" else SCHEDULE_PRACTICE
    row.schedule_reason = schedule_reason
    row.updated_at = _now()
    _ensure_item(
        session,
        wave,
        palace_id=row.palace_id,
        node_uid=row.node_uid,
        status=ITEM_PENDING,
        raw_due_at=raw_due_at,
        effective_due_at=effective,
    )
    # Remove node from other scheduled formal waves' pending items.
    _detach_from_other_formal_waves(session, row, keep_wave_id=wave.id)
    return wave


def _detach_from_other_formal_waves(
    session: Session, row: ReviewNodeState, *, keep_wave_id: str
) -> None:
    items = (
        session.query(ReviewWaveItem)
        .join(ReviewWave, ReviewWave.id == ReviewWaveItem.wave_id)
        .filter(
            ReviewWaveItem.palace_id == row.palace_id,
            ReviewWaveItem.node_uid == row.node_uid,
            ReviewWaveItem.wave_id != keep_wave_id,
            ReviewWave.wave_type == WAVE_TYPE_FORMAL,
            ReviewWave.status == WAVE_STATUS_SCHEDULED,
            ReviewWaveItem.status == ITEM_PENDING,
        )
        .all()
    )
    for item in items:
        session.delete(item)
        wave = session.get(ReviewWave, item.wave_id)
        if wave is not None:
            wave.item_count = max(0, int(wave.item_count or 0) - 1)
            wave.updated_at = _now()
            close_empty_open_wave(session, wave)


def assign_node_to_reinforcement(
    session: Session,
    row: ReviewNodeState,
    *,
    rating: int,
    raw_due_at: datetime | None = None,
) -> ReviewWave:
    """Park a weak-rated node on the next same-day restudy batch (immediately available)."""
    remove_node_from_open_waves(session, row)
    if reinforcement_delay_minutes(rating) is None:
        raise ValueError("reinforcement only for rating 1 or 2")
    # Batch restudy: no clock wait — next pass is end of current queue / auto-chain.
    available_at = _now()
    wave = get_or_create_reinforcement_wave(session, row.palace_id, available_at)
    if raw_due_at is not None:
        row.raw_due_at = raw_due_at
    # Park effective due on reinforcement available time so dual-date projections
    # stay coherent. Formal eligibility is gated by schedule_source=reinforcement.
    row.due_at = available_at
    row.effective_wave_id = wave.id
    row.effective_local_date = None
    row.schedule_source = SCHEDULE_REINFORCEMENT
    row.schedule_reason = f"reinforcement_r{rating}_batch"
    row.updated_at = _now()
    _ensure_item(
        session,
        wave,
        palace_id=row.palace_id,
        node_uid=row.node_uid,
        status=ITEM_PENDING_REINFORCEMENT,
        raw_due_at=row.raw_due_at,
        effective_due_at=available_at,
    )
    return wave


def apply_rating_to_schedule(
    session: Session,
    row: ReviewNodeState,
    *,
    rating: int,
    raw_due_at: datetime,
    evidence_origin: str,
    source_scene: str,
    desired_retention: float | None = None,
) -> dict[str, Any]:
    """After FSRS card write: route weak→reinforcement, strong→formal adsorb."""
    if evidence_origin == "direct":
        row.last_direct_review_at = _now()
        row.evidence_source = "direct"
    elif evidence_origin in {"branch_recall", "batch_inherited"}:
        row.evidence_source = evidence_origin
    if source_scene in {"practice", "local_practice"}:
        row.last_practice_at = _now()

    if rating in (1, 2):
        wave = assign_node_to_reinforcement(session, row, rating=rating, raw_due_at=raw_due_at)
        return {
            "wave_id": wave.id,
            "wave_type": wave.wave_type,
            "schedule_source": row.schedule_source,
            "raw_due_at": to_api_datetime(row.raw_due_at),
            "due_at": to_api_datetime(row.due_at),
            "schedule_reason": row.schedule_reason,
        }

    from memory_anki.modules.memory.application.scheduling.aggregation import (
        aggregation_enabled,
        aggregation_policy_for,
        get_palace_review_settings,
    )

    reason = "practice" if source_scene in {"practice", "local_practice"} else "manual"
    raw_local = local_date_of(raw_due_at)
    today = local_date_of(_now())
    policy = aggregation_policy_for(get_palace_review_settings(session, row.palace_id))
    # 短间隔卡永不进单元波次：学习步（10m/1h）与刚恢复的差卡属于「今日巩固」
    # 的范畴，一张这样的卡不该唤醒整个宫殿会话。按**间隔**判断而不是按日期——
    # 日期判断会在临近午夜时把 +1 小时的学习步卡误判成"未来某天"。
    is_short_interval = (
        raw_due_at - _now()
    ).total_seconds() < policy.consolidate_floor_days * 86400
    if (
        aggregation_enabled(session, row.palace_id)
        and raw_local > today
        and not is_short_interval
    ):
        wave = assign_node_to_formal_wave(
            session,
            row,
            raw_due_at=raw_due_at,
            reason=reason,
            desired_retention=desired_retention,
        )
        return {
            "wave_id": wave.id,
            "wave_type": wave.wave_type,
            "schedule_source": row.schedule_source,
            "raw_due_at": to_api_datetime(row.raw_due_at),
            "due_at": to_api_datetime(row.due_at),
            "schedule_reason": row.schedule_reason,
        }

    # 默认：FSRS 直出。due_at 即 raw_due_at，不进任何波次。
    remove_node_from_open_waves(session, row)
    row.raw_due_at = raw_due_at
    row.due_at = raw_due_at
    row.effective_wave_id = None
    row.effective_local_date = None
    row.schedule_source = (
        SCHEDULE_PRACTICE if source_scene in {"practice", "local_practice"} else SCHEDULE_MANUAL
    )
    row.schedule_reason = "fsrs_direct"
    row.updated_at = _now()
    return {
        "wave_id": None,
        "wave_type": None,
        "schedule_source": row.schedule_source,
        "raw_due_at": to_api_datetime(row.raw_due_at),
        "due_at": to_api_datetime(row.due_at),
        "schedule_reason": row.schedule_reason,
    }


def mark_wave_item_rated(
    session: Session,
    *,
    palace_id: int,
    node_uid: str,
    wave_id: str | None,
    rating: int,
    evidence_origin: str,
    operation_id: str,
    wave: ReviewWave | None = None,
) -> None:
    if not wave_id:
        return
    item = (
        session.query(ReviewWaveItem)
        .filter(
            ReviewWaveItem.wave_id == wave_id,
            ReviewWaveItem.palace_id == palace_id,
            ReviewWaveItem.node_uid == node_uid,
        )
        .first()
    )
    if item is None:
        return
    now = _now()
    was_rated = item.status in (ITEM_RATED_DIRECT, ITEM_RATED_INHERITED, ITEM_DONE)
    item.rating = rating
    item.rated_at = now
    item.rating_operation_id = operation_id
    item.evidence_origin = evidence_origin
    if evidence_origin == "direct":
        item.status = ITEM_RATED_DIRECT
    elif evidence_origin == "bulk_mark":
        # 批量带过：波次项直接完结，不伪装成已评分证据。
        item.status = ITEM_DONE
    else:
        item.status = ITEM_RATED_INHERITED
    item.updated_at = now
    wave_row = wave if wave is not None and wave.id == wave_id else session.get(ReviewWave, wave_id)
    if wave_row is not None:
        # Avoid a COUNT(*) on every leaf score; only bump when newly rated.
        if not was_rated:
            wave_row.rated_count = int(wave_row.rated_count or 0) + 1
        wave_row.updated_at = now


def start_formal_wave(
    session: Session,
    palace_id: int,
    *,
    node_uids: list[str] | None = None,
    session_id: str | None = None,
    unit_root_uid: str | None = None,
) -> ReviewWave:
    """Freeze due+overdue nodes into an active formal wave (no auto-expand later).

    冻结集可以跨单元（同一宫殿同一天到期的多个单元合并为一次会话），此时
    ``unit_root_uid`` 记的是首个单元——它只是波次的归属标签，不约束成员。
    """
    existing = find_active_formal_wave(session, palace_id)
    if existing is not None:
        if session_id:
            existing.active_session_id = session_id
            existing.updated_at = _now()
            if existing.status == WAVE_STATUS_PAUSED:
                existing.status = WAVE_STATUS_ACTIVE
                existing.paused_at = None
        return existing

    uids = node_uids if node_uids is not None else formal_due_node_uids(session, palace_id)
    if not uids:
        raise ValueError("palace has no due formal wave nodes")

    today = local_date_of(_now())
    unit_uid = unit_root_uid or resolve_unit_root_uid(session, palace_id, uids[0])
    wave = get_or_create_formal_wave(
        session,
        palace_id,
        today,
        unit_root_uid=unit_uid,
        status=WAVE_STATUS_ACTIVE,
    )
    now = _now()
    wave.status = WAVE_STATUS_ACTIVE
    wave.frozen_at = now
    wave.paused_at = None
    wave.active_session_id = session_id
    wave.updated_at = now

    states = {
        row.node_uid: row
        for row in session.query(ReviewNodeState)
        .filter(
            ReviewNodeState.palace_id == palace_id,
            ReviewNodeState.node_uid.in_(uids),
        )
        .all()
    }
    for uid in uids:
        row = states.get(uid)
        raw = row.raw_due_at if row else None
        eff = row.due_at if row else None
        _ensure_item(
            session,
            wave,
            palace_id=palace_id,
            node_uid=uid,
            status=ITEM_PENDING,
            raw_due_at=raw,
            effective_due_at=eff,
        )
        if row is not None:
            row.effective_wave_id = wave.id
            row.effective_local_date = today
            row.updated_at = now
    session.flush()
    wave.item_count = (
        session.query(ReviewWaveItem).filter(ReviewWaveItem.wave_id == wave.id).count()
    )
    return wave


def merge_new_due_into_wave(
    session: Session,
    wave_id: str,
    *,
    node_uids: list[str] | None = None,
) -> ReviewWave:
    """User-confirmed expansion of the frozen set."""
    wave = session.get(ReviewWave, wave_id)
    if wave is None or wave.wave_type != WAVE_TYPE_FORMAL:
        raise ValueError("formal wave not found")
    if wave.status not in {WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED}:
        raise ValueError("wave is not open")
    frozen = {
        item.node_uid
        for item in session.query(ReviewWaveItem)
        .filter(ReviewWaveItem.wave_id == wave.id)
        .all()
    }
    candidates = (
        set(node_uids)
        if node_uids is not None
        else set(formal_due_node_uids(session, wave.palace_id)) - frozen
    )
    to_add = sorted(candidates - frozen)
    now = _now()
    states = {
        row.node_uid: row
        for row in session.query(ReviewNodeState)
        .filter(
            ReviewNodeState.palace_id == wave.palace_id,
            ReviewNodeState.node_uid.in_(to_add),
        )
        .all()
        if to_add
    }
    for uid in to_add:
        row = states.get(uid)
        _ensure_item(
            session,
            wave,
            palace_id=wave.palace_id,
            node_uid=uid,
            status=ITEM_PENDING,
            raw_due_at=row.raw_due_at if row else None,
            effective_due_at=row.due_at if row else None,
        )
        if row is not None:
            row.effective_wave_id = wave.id
            row.effective_local_date = wave.local_date
            row.updated_at = now
    session.flush()
    _recount_wave(session, wave)
    _sync_active_session_scope(session, wave)
    return wave


def mark_content_changed(session: Session, row: ReviewNodeState) -> None:
    remove_node_from_open_waves(session, row)
    row.schedule_source = SCHEDULE_CONTENT_CHANGED
    row.schedule_reason = "content_fingerprint_changed"
    row.updated_at = _now()


def mark_uninitialized(session: Session, row: ReviewNodeState) -> None:
    remove_node_from_open_waves(session, row)
    row.schedule_source = SCHEDULE_UNINITIALIZED
    row.schedule_reason = "no_memory_yet"
    row.raw_due_at = None
    row.effective_wave_id = None
    row.effective_local_date = None


def remove_node_from_open_waves(session: Session, row: ReviewNodeState) -> None:
    items = (
        session.query(ReviewWaveItem)
        .join(ReviewWave, ReviewWave.id == ReviewWaveItem.wave_id)
        .filter(
            ReviewWaveItem.palace_id == row.palace_id,
            ReviewWaveItem.node_uid == row.node_uid,
            ReviewWave.status.in_(
                [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
            ),
            ReviewWaveItem.status.in_([ITEM_PENDING, ITEM_PENDING_REINFORCEMENT]),
        )
        .all()
    )
    affected: dict[str, ReviewWave] = {}
    for item in items:
        wave = session.get(ReviewWave, item.wave_id)
        if wave is not None:
            affected[wave.id] = wave
        session.delete(item)
    if items:
        session.flush()
    for wave in affected.values():
        _recount_wave(session, wave)
        if close_empty_open_wave(session, wave):
            continue
        _sync_active_session_scope(session, wave)


def reconcile_rating_undo(
    session: Session,
    *,
    palace_id: int,
    node_uid: str,
    operation_id: str,
    target_wave_id: str | None,
    restored_wave_id: str | None,
) -> None:
    items = (
        session.query(ReviewWaveItem)
        .join(ReviewWave, ReviewWave.id == ReviewWaveItem.wave_id)
        .filter(
            ReviewWaveItem.palace_id == palace_id,
            ReviewWaveItem.node_uid == node_uid,
            ReviewWave.status.in_(
                [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
            ),
        )
        .all()
    )
    affected: dict[str, ReviewWave] = {}
    for item in items:
        wave = session.get(ReviewWave, item.wave_id)
        if wave is None:
            continue
        if item.rating_operation_id == operation_id:
            item.status = (
                ITEM_PENDING_REINFORCEMENT
                if wave.wave_type == WAVE_TYPE_REINFORCEMENT
                else ITEM_PENDING
            )
            item.evidence_origin = None
            item.rating = None
            item.rated_at = None
            item.rating_operation_id = None
            item.updated_at = _now()
            affected[wave.id] = wave
            continue
        if (
            target_wave_id
            and item.wave_id == target_wave_id
            and item.wave_id != restored_wave_id
            and item.status in {ITEM_PENDING, ITEM_PENDING_REINFORCEMENT}
        ):
            session.delete(item)
            affected[wave.id] = wave
    session.flush()
    for wave in affected.values():
        _recount_wave(session, wave)
        if close_empty_open_wave(session, wave):
            continue
        _sync_active_session_scope(session, wave)
