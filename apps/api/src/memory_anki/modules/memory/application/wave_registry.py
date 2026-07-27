"""Wave rows and membership primitives (create / recount / close / item upsert).

Split out of ``wave_service`` so the scheduling policy in that module stays
readable. This layer knows nothing about FSRS ratings — it only owns wave row
lifecycle and item bookkeeping.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.reviews import ReviewWave, ReviewWaveItem
from memory_anki.modules.memory.application.wave_policy import (
    ITEM_DONE,
    ITEM_PENDING,
    ITEM_RATED_DIRECT,
    ITEM_RATED_INHERITED,
    WAVE_STATUS_ACTIVE,
    WAVE_STATUS_CANCELLED,
    WAVE_STATUS_PAUSED,
    WAVE_STATUS_SCHEDULED,
    WAVE_TYPE_FORMAL,
    WAVE_TYPE_REINFORCEMENT,
    WaveCandidate,
)
from memory_anki.modules.memory.application.wave_queries import frozen_node_uids

_OPEN_STATUSES = [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
_RATED_STATUSES = [ITEM_RATED_DIRECT, ITEM_RATED_INHERITED, ITEM_DONE]
_CANDIDATE_CACHE_KEY = "_formal_wave_candidates"


def now_naive() -> datetime:
    return utc_now_naive()


def new_wave_id(prefix: str = "wave") -> str:
    return f"{prefix}-{uuid.uuid4()}"


def recount_wave(session: Session, wave: ReviewWave) -> None:
    wave.item_count = (
        session.query(ReviewWaveItem).filter(ReviewWaveItem.wave_id == wave.id).count()
    )
    wave.rated_count = (
        session.query(ReviewWaveItem)
        .filter(
            ReviewWaveItem.wave_id == wave.id,
            ReviewWaveItem.status.in_(_RATED_STATUSES),
        )
        .count()
    )
    wave.updated_at = now_naive()


def close_empty_open_wave(session: Session, wave: ReviewWave) -> bool:
    """Remove or cancel open waves that have no remaining items.

    Scheduled empty shells are deleted. Active/paused empty shells (often left
    after abandoned sessions or node reassignment) are cancelled so they stop
    appearing in the insights reinforcement list.
    """
    if wave.status not in set(_OPEN_STATUSES):
        return False
    recount_wave(session, wave)
    if int(wave.item_count or 0) > 0:
        return False
    now = now_naive()
    if wave.status == WAVE_STATUS_SCHEDULED:
        session.delete(wave)
        return True
    wave.status = WAVE_STATUS_CANCELLED
    wave.completed_at = now
    wave.active_session_id = None
    wave.paused_at = None
    wave.updated_at = now
    return True


def sync_active_session_scope(session: Session, wave: ReviewWave) -> None:
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
    study_session.updated_at = now_naive()


def formal_candidates(
    session: Session, palace_id: int, *, unit_root_uid: str | None = None
) -> list[WaveCandidate]:
    """Open formal waves of one palace, optionally narrowed to one unit."""
    cache = session.info.setdefault(_CANDIDATE_CACHE_KEY, {})
    cached = cache.get(palace_id)
    if cached is None:
        rows = (
            session.query(ReviewWave)
            .filter(
                ReviewWave.palace_id == palace_id,
                ReviewWave.wave_type == WAVE_TYPE_FORMAL,
                ReviewWave.status.in_(_OPEN_STATUSES),
                ReviewWave.local_date.is_not(None),
            )
            .all()
        )
        cached = [
            WaveCandidate(
                wave_id=row.id,
                local_date=row.local_date,
                status=row.status,
                unit_root_uid=row.unit_root_uid,
            )
            for row in rows
            if row.local_date is not None
        ]
        cache[palace_id] = cached
    if unit_root_uid is None:
        return list(cached)
    return [item for item in cached if item.unit_root_uid == unit_root_uid]


def invalidate_formal_candidates(session: Session, palace_id: int) -> None:
    cache = session.info.get(_CANDIDATE_CACHE_KEY)
    if cache is not None:
        cache.pop(palace_id, None)


def _find_formal_wave(
    session: Session, palace_id: int, local_day: date, unit_root_uid: str | None
) -> ReviewWave | None:
    query = session.query(ReviewWave).filter(
        ReviewWave.palace_id == palace_id,
        ReviewWave.wave_type == WAVE_TYPE_FORMAL,
        ReviewWave.local_date == local_day,
        ReviewWave.status.in_(_OPEN_STATUSES),
    )
    if unit_root_uid is not None:
        query = query.filter(ReviewWave.unit_root_uid == unit_root_uid)
    return query.first()


def get_or_create_formal_wave(
    session: Session,
    palace_id: int,
    local_day: date,
    *,
    unit_root_uid: str | None = None,
    status: str = WAVE_STATUS_SCHEDULED,
) -> ReviewWave:
    """One open formal wave per (palace, unit, local day)."""
    existing = _find_formal_wave(session, palace_id, local_day, unit_root_uid)
    if existing is not None:
        return existing
    wave = ReviewWave(
        id=new_wave_id("fw"),
        palace_id=palace_id,
        wave_type=WAVE_TYPE_FORMAL,
        status=status,
        local_date=local_day,
        unit_root_uid=unit_root_uid,
        created_at=now_naive(),
        updated_at=now_naive(),
    )
    invalidate_formal_candidates(session, palace_id)
    try:
        with session.begin_nested():
            session.add(wave)
            session.flush()
    except IntegrityError:
        existing = _find_formal_wave(session, palace_id, local_day, unit_root_uid)
        if existing is None:
            raise
        return existing
    return wave


def get_or_create_reinforcement_wave(
    session: Session,
    palace_id: int,
    available_at: datetime,
) -> ReviewWave:
    """Merge reinforcement into a non-active same-palace restudy bucket.

    Never merge into an ACTIVE wave: weak re-ratings during a pass must land on
    the *next* batch so the current freeze can complete, then auto-chain.
    Reinforcement is palace-scoped (no unit dimension) by design — same-day
    restudy is about the current session, not the long-term unit rhythm.
    """
    # Prefer any already-available scheduled/paused shell (end-of-batch restudy).
    mature = (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_REINFORCEMENT,
            ReviewWave.status.in_([WAVE_STATUS_SCHEDULED, WAVE_STATUS_PAUSED]),
            ReviewWave.available_at.is_not(None),
            ReviewWave.available_at <= now_naive(),
        )
        .order_by(ReviewWave.available_at.asc())
        .first()
    )
    if mature is not None:
        return mature
    window_start = available_at - timedelta(minutes=5)
    window_end = available_at + timedelta(minutes=5)
    existing = (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_REINFORCEMENT,
            ReviewWave.status.in_([WAVE_STATUS_SCHEDULED, WAVE_STATUS_PAUSED]),
            ReviewWave.available_at.is_not(None),
            ReviewWave.available_at >= window_start,
            ReviewWave.available_at <= window_end,
        )
        .order_by(ReviewWave.available_at.asc())
        .first()
    )
    if existing is not None:
        return existing
    wave = ReviewWave(
        id=new_wave_id("rw"),
        palace_id=palace_id,
        wave_type=WAVE_TYPE_REINFORCEMENT,
        status=WAVE_STATUS_SCHEDULED,
        available_at=available_at,
        created_at=now_naive(),
        updated_at=now_naive(),
    )
    session.add(wave)
    session.flush()
    return wave


def ensure_item(
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
    now = now_naive()
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


def load_reinforcement_settings(session: Session) -> tuple[int, int]:
    """Legacy settings accessor; batch restudy always uses zero delay."""
    del session
    return (0, 0)
