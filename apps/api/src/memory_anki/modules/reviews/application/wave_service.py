"""Palace review wave lifecycle and schedule adsorption."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import Config, StudySession
from memory_anki.infrastructure.db._tables.reviews import (
    ReviewNodeState,
    ReviewWave,
    ReviewWaveItem,
)
from memory_anki.modules.reviews.application.wave_policy import (
    DEFAULT_AGAIN_REINFORCEMENT_MINUTES,
    DEFAULT_HARD_REINFORCEMENT_MINUTES,
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
from memory_anki.modules.reviews.application.wave_queries import (
    find_active_formal_wave,
    formal_due_node_uids,
    frozen_node_uids,
    get_wave_detail,
    list_palace_waves,
    wave_progress,
)
from memory_anki.modules.reviews.application.wave_session_service import (
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
    "complete_formal_wave",
    "find_active_formal_wave",
    "formal_due_node_uids",
    "frozen_node_uids",
    "get_or_create_formal_wave",
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


def _now() -> datetime:
    return utc_now_naive()


def _new_wave_id(prefix: str = "wave") -> str:
    return f"{prefix}-{uuid.uuid4()}"


def _recount_wave(session: Session, wave: ReviewWave) -> None:
    wave.item_count = (
        session.query(ReviewWaveItem).filter(ReviewWaveItem.wave_id == wave.id).count()
    )
    wave.rated_count = (
        session.query(ReviewWaveItem)
        .filter(
            ReviewWaveItem.wave_id == wave.id,
            ReviewWaveItem.status.in_(
                [ITEM_RATED_DIRECT, ITEM_RATED_INHERITED, ITEM_DONE]
            ),
        )
        .count()
    )
    wave.updated_at = _now()


def _sync_active_session_scope(session: Session, wave: ReviewWave) -> None:
    if not wave.active_session_id:
        return
    study_session = session.get(StudySession, wave.active_session_id)
    if study_session is None or study_session.scene != "review":
        return
    try:
        summary = json.loads(study_session.summary_json or "{}")
    except (TypeError, ValueError):
        summary = {}
    summary["wave_id"] = wave.id
    summary["frozen_due_node_uids"] = frozen_node_uids(session, wave.id)
    study_session.summary_json = json.dumps(summary, ensure_ascii=False)
    study_session.updated_at = _now()


def load_reinforcement_settings(session: Session) -> tuple[int, int]:
    cached = session.info.get("_reinforcement_settings")
    if cached is not None:
        return cached
    keys = ("reinforcement_again_minutes", "reinforcement_hard_minutes")
    values = {
        row.key: row.value
        for row in session.query(Config).filter(Config.key.in_(keys)).all()
    }
    again = DEFAULT_AGAIN_REINFORCEMENT_MINUTES
    hard = DEFAULT_HARD_REINFORCEMENT_MINUTES
    try:
        again = int(values.get("reinforcement_again_minutes", again))
    except (TypeError, ValueError):
        pass
    try:
        hard = int(values.get("reinforcement_hard_minutes", hard))
    except (TypeError, ValueError):
        pass
    result = (max(1, again), max(1, hard))
    session.info["_reinforcement_settings"] = result
    return result


def formal_candidates(session: Session, palace_id: int) -> list[WaveCandidate]:
    cache = session.info.setdefault("_formal_wave_candidates", {})
    cached = cache.get(palace_id)
    if cached is not None:
        return list(cached)
    rows = (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_FORMAL,
            ReviewWave.status.in_(
                [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
            ),
            ReviewWave.local_date.is_not(None),
        )
        .all()
    )
    result = [
        WaveCandidate(wave_id=row.id, local_date=row.local_date, status=row.status)
        for row in rows
        if row.local_date is not None
    ]
    cache[palace_id] = list(result)
    return list(result)


def _invalidate_formal_candidates(session: Session, palace_id: int) -> None:
    cache = session.info.get("_formal_wave_candidates")
    if cache is not None:
        cache.pop(palace_id, None)


def get_or_create_formal_wave(
    session: Session,
    palace_id: int,
    local_day: date,
    *,
    status: str = WAVE_STATUS_SCHEDULED,
) -> ReviewWave:
    existing = (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_FORMAL,
            ReviewWave.local_date == local_day,
            ReviewWave.status.in_(
                [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
            ),
        )
        .first()
    )
    if existing is not None:
        return existing
    wave = ReviewWave(
        id=_new_wave_id("fw"),
        palace_id=palace_id,
        wave_type=WAVE_TYPE_FORMAL,
        status=status,
        local_date=local_day,
        created_at=_now(),
        updated_at=_now(),
    )
    _invalidate_formal_candidates(session, palace_id)
    try:
        with session.begin_nested():
            session.add(wave)
            session.flush()
    except IntegrityError:
        existing = (
            session.query(ReviewWave)
            .filter(
                ReviewWave.palace_id == palace_id,
                ReviewWave.wave_type == WAVE_TYPE_FORMAL,
                ReviewWave.local_date == local_day,
                ReviewWave.status.in_(
                    [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
                ),
            )
            .first()
        )
        if existing is None:
            raise
        return existing
    return wave


def get_or_create_reinforcement_wave(
    session: Session,
    palace_id: int,
    available_at: datetime,
) -> ReviewWave:
    """Merge reinforcement into the nearest same-palace open reinforcement bucket."""
    window_start = available_at - timedelta(minutes=5)
    window_end = available_at + timedelta(minutes=5)
    existing = (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_REINFORCEMENT,
            ReviewWave.status.in_(
                [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
            ),
            ReviewWave.available_at.is_not(None),
            ReviewWave.available_at >= window_start,
            ReviewWave.available_at <= window_end,
        )
        .order_by(ReviewWave.available_at.asc())
        .first()
    )
    if existing is not None:
        return existing
    # Also merge into any mature (already available) open reinforcement wave for the palace.
    mature = (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_REINFORCEMENT,
            ReviewWave.status.in_(
                [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
            ),
            ReviewWave.available_at.is_not(None),
            ReviewWave.available_at <= _now(),
        )
        .order_by(ReviewWave.available_at.asc())
        .first()
    )
    if mature is not None and mature.available_at is not None:
        # Keep the earlier available_at so the wave stays due.
        return mature
    wave = ReviewWave(
        id=_new_wave_id("rw"),
        palace_id=palace_id,
        wave_type=WAVE_TYPE_REINFORCEMENT,
        status=WAVE_STATUS_SCHEDULED,
        available_at=available_at,
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(wave)
    session.flush()
    return wave


def _ensure_item(
    session: Session,
    wave: ReviewWave,
    *,
    palace_id: int,
    node_uid: str,
    status: str = ITEM_PENDING,
    raw_due_at: datetime | None = None,
    effective_due_at: datetime | None = None,
) -> ReviewWaveItem:
    item = (
        session.query(ReviewWaveItem)
        .filter(ReviewWaveItem.wave_id == wave.id, ReviewWaveItem.node_uid == node_uid)
        .first()
    )
    now = _now()
    if item is None:
        item = ReviewWaveItem(
            wave_id=wave.id,
            palace_id=palace_id,
            node_uid=node_uid,
            status=status,
            frozen_raw_due_at=raw_due_at,
            frozen_effective_due_at=effective_due_at,
            included_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(item)
        wave.item_count = int(wave.item_count or 0) + 1
    else:
        item.status = status
        item.updated_at = now
        if raw_due_at is not None:
            item.frozen_raw_due_at = raw_due_at
        if effective_due_at is not None:
            item.frozen_effective_due_at = effective_due_at
    wave.updated_at = now
    return item


def assign_node_to_formal_wave(
    session: Session,
    row: ReviewNodeState,
    *,
    raw_due_at: datetime,
    reason: str,
    desired_retention: float | None = None,
    force_new_day: date | None = None,
) -> ReviewWave:
    """Adsorb a node into the nearest safe formal wave or create one for raw_due's day."""
    remove_node_from_open_waves(session, row)
    raw_local = local_date_of(raw_due_at)
    target_day = force_new_day or raw_local
    candidates = formal_candidates(session, row.palace_id)
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
        )
    if picked is not None:
        wave = session.get(ReviewWave, picked.wave_id)
        if wave is None:
            wave = get_or_create_formal_wave(session, row.palace_id, target_day)
        schedule_reason = f"adsorb_existing:{reason}"
        schedule_source = SCHEDULE_WAVE_ADSORB
    else:
        wave = get_or_create_formal_wave(session, row.palace_id, target_day)
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


def assign_node_to_reinforcement(
    session: Session,
    row: ReviewNodeState,
    *,
    rating: int,
    raw_due_at: datetime | None = None,
) -> ReviewWave:
    remove_node_from_open_waves(session, row)
    again_m, hard_m = load_reinforcement_settings(session)
    delay = reinforcement_delay_minutes(rating, again_minutes=again_m, hard_minutes=hard_m)
    if delay is None:
        raise ValueError("reinforcement only for rating 1 or 2")
    available_at = _now() + timedelta(minutes=delay)
    wave = get_or_create_reinforcement_wave(session, row.palace_id, available_at)
    if raw_due_at is not None:
        row.raw_due_at = raw_due_at
    # Keep formal due_at out of short window: park effective due on reinforcement available time
    # so queue projections that still read due_at do not show formal due immediately.
    # Formal eligibility is gated by schedule_source=reinforcement.
    row.due_at = available_at
    row.effective_wave_id = wave.id
    row.effective_local_date = None
    row.schedule_source = SCHEDULE_REINFORCEMENT
    row.schedule_reason = f"reinforcement_r{rating}_{delay}m"
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
    elif evidence_origin == "batch_inherited":
        row.evidence_source = "batch_inherited"
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

    reason = "practice" if source_scene in {"practice", "local_practice"} else "manual"
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
    item.status = (
        ITEM_RATED_DIRECT if evidence_origin == "direct" else ITEM_RATED_INHERITED
    )
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
) -> ReviewWave:
    """Freeze due+overdue nodes into an active formal wave (no auto-expand later)."""
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
    wave = get_or_create_formal_wave(
        session, palace_id, today, status=WAVE_STATUS_ACTIVE
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
        _sync_active_session_scope(session, wave)
