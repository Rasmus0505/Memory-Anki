"""Read models for palace review waves."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
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
    SCHEDULE_REINFORCEMENT,
    WAVE_STATUS_ACTIVE,
    WAVE_STATUS_PAUSED,
    WAVE_STATUS_SCHEDULED,
    WAVE_TYPE_FORMAL,
    WAVE_TYPE_REINFORCEMENT,
    is_formal_queue_eligible,
    local_date_of,
)


def wave_payload(wave: ReviewWave) -> dict[str, Any]:
    return {
        "id": wave.id,
        "palace_id": wave.palace_id,
        "wave_type": wave.wave_type,
        "status": wave.status,
        "local_date": wave.local_date.isoformat() if wave.local_date else None,
        "available_at": to_api_datetime(wave.available_at),
        "frozen_at": to_api_datetime(wave.frozen_at),
        "paused_at": to_api_datetime(wave.paused_at),
        "completed_at": to_api_datetime(wave.completed_at),
        "active_session_id": wave.active_session_id,
        "item_count": int(wave.item_count or 0),
        "rated_count": int(wave.rated_count or 0),
        "pending_count": max(0, int(wave.item_count or 0) - int(wave.rated_count or 0)),
    }


def find_available_reinforcement_for_palace(
    session: Session, palace_id: int
) -> dict[str, Any] | None:
    """Next restudy batch for a palace: open reinforcement with pending items.

    Used by formal completion receipts so the client can auto-chain into the
    end-of-batch restudy pass without a clock wait.
    """
    now = utc_now_naive()
    waves = (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_REINFORCEMENT,
            ReviewWave.status.in_(
                [WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]
            ),
            ReviewWave.available_at.is_not(None),
            ReviewWave.available_at <= now,
        )
        .order_by(ReviewWave.available_at.asc(), ReviewWave.id.asc())
        .all()
    )
    for wave in waves:
        pending = (
            session.query(ReviewWaveItem)
            .filter(
                ReviewWaveItem.wave_id == wave.id,
                ReviewWaveItem.status.in_([ITEM_PENDING, ITEM_PENDING_REINFORCEMENT]),
            )
            .count()
        )
        if pending > 0:
            return {
                "wave_id": wave.id,
                "pending_count": int(pending),
            }
    return None


def list_palace_waves(session: Session, palace_id: int) -> list[dict[str, Any]]:
    rows = (
        session.query(ReviewWave)
        .filter(ReviewWave.palace_id == palace_id)
        .order_by(
            ReviewWave.wave_type.asc(),
            ReviewWave.local_date.asc(),
            ReviewWave.available_at.asc(),
        )
        .all()
    )
    return [wave_payload(row) for row in rows]


def get_wave_detail(session: Session, wave_id: str) -> dict[str, Any]:
    wave = session.get(ReviewWave, wave_id)
    if wave is None:
        raise ValueError("wave not found")
    items = (
        session.query(ReviewWaveItem)
        .filter(ReviewWaveItem.wave_id == wave_id)
        .order_by(ReviewWaveItem.node_uid.asc())
        .all()
    )
    payload = wave_payload(wave)
    payload["items"] = [
        {
            "node_uid": item.node_uid,
            "status": item.status,
            "evidence_origin": item.evidence_origin,
            "rating": item.rating,
            "rated_at": to_api_datetime(item.rated_at),
            "frozen_raw_due_at": to_api_datetime(item.frozen_raw_due_at),
            "frozen_effective_due_at": to_api_datetime(item.frozen_effective_due_at),
        }
        for item in items
    ]
    return payload


def formal_due_node_uids(
    session: Session,
    palace_id: int,
    *,
    now: datetime | None = None,
    include_overdue: bool = True,
) -> list[str]:
    """Nodes eligible for a new formal freeze (due/overdue + first-learn).

    Walks the palace tree so brand-new palaces without ``ReviewNodeState`` rows
    still freeze every non-root card for first learning.
    """
    from memory_anki.infrastructure.db._tables.palaces import Palace
    from memory_anki.modules.memory.application.node_memory_projection import _tree

    now = now or utc_now_naive()
    today = local_date_of(now)
    palace = session.get(Palace, palace_id)
    if palace is None or palace.deleted_at is not None:
        return []
    root_uid, nodes = _tree(palace)
    states = {
        row.node_uid: row
        for row in session.query(ReviewNodeState)
        .filter(ReviewNodeState.palace_id == palace_id)
        .all()
    }
    result: list[str] = []
    for uid in nodes:
        if root_uid is not None and uid == root_uid:
            continue
        row = states.get(uid)
        if row is None:
            result.append(uid)
            continue
        has_memory = row.last_review_at is not None
        if not is_formal_queue_eligible(row.schedule_source, has_memory=has_memory):
            continue
        if row.schedule_source == SCHEDULE_REINFORCEMENT:
            continue
        # Never-reviewed nodes: always due for first learning.
        if not has_memory:
            result.append(uid)
            continue
        if row.effective_local_date is not None:
            if (
                row.effective_local_date <= today
                if include_overdue
                else row.effective_local_date == today
            ):
                result.append(uid)
            continue
        if row.due_at is not None and row.due_at <= now:
            result.append(uid)
    return sorted(set(result))


def find_active_formal_wave(session: Session, palace_id: int) -> ReviewWave | None:
    return (
        session.query(ReviewWave)
        .filter(
            ReviewWave.palace_id == palace_id,
            ReviewWave.wave_type == WAVE_TYPE_FORMAL,
            ReviewWave.status.in_([WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED]),
        )
        .order_by(ReviewWave.updated_at.desc())
        .first()
    )


def frozen_node_uids(session: Session, wave_id: str) -> list[str]:
    return [
        item.node_uid
        for item in session.query(ReviewWaveItem)
        .filter(ReviewWaveItem.wave_id == wave_id)
        .order_by(ReviewWaveItem.node_uid.asc())
        .all()
    ]


def wave_progress(session: Session, wave_id: str) -> dict[str, Any]:
    items = session.query(ReviewWaveItem).filter(ReviewWaveItem.wave_id == wave_id).all()
    rated = [
        item
        for item in items
        if item.status in {ITEM_RATED_DIRECT, ITEM_RATED_INHERITED, ITEM_DONE}
    ]
    direct = sum(
        1 for item in rated if item.status == ITEM_RATED_DIRECT or item.evidence_origin == "direct"
    )
    inherited = sum(
        1
        for item in rated
        if item.evidence_origin == "batch_inherited" or item.status == ITEM_RATED_INHERITED
    )
    return {
        "item_count": len(items),
        "rated_count": len(rated),
        "pending_count": len(items) - len(rated),
        "direct_rated_count": direct,
        "inherited_rated_count": inherited,
        "complete": len(rated) == len(items) and len(items) > 0,
    }
