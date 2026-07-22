"""Execution-session lifecycle for formal and reinforcement review waves."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewWave, ReviewWaveItem
from memory_anki.modules.reviews.application.wave_policy import (
    ITEM_DONE,
    ITEM_RATED_DIRECT,
    ITEM_RATED_INHERITED,
    WAVE_STATUS_ACTIVE,
    WAVE_STATUS_COMPLETED,
    WAVE_STATUS_PAUSED,
    WAVE_STATUS_SCHEDULED,
    WAVE_TYPE_FORMAL,
    WAVE_TYPE_REINFORCEMENT,
)
from memory_anki.modules.reviews.application.wave_queries import (
    formal_due_node_uids,
    frozen_node_uids,
    wave_payload,
)


def _now() -> datetime:
    return utc_now_naive()


def pause_formal_wave(session: Session, wave_id: str) -> ReviewWave:
    wave = session.get(ReviewWave, wave_id)
    if wave is None:
        raise ValueError("review wave not found")
    if wave.status not in {WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED}:
        raise ValueError("wave is not active")
    wave.status = WAVE_STATUS_PAUSED
    wave.paused_at = _now()
    wave.updated_at = wave.paused_at
    if wave.active_session_id:
        study_session = session.get(StudySession, wave.active_session_id)
        if study_session is not None and study_session.status in {"active", "paused"}:
            study_session.status = "paused"
            study_session.pause_count = int(study_session.pause_count or 0) + 1
            study_session.updated_at = wave.paused_at
    return wave


def resume_formal_wave(
    session: Session,
    wave_id: str,
    *,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Resume a wave without implicitly expanding its frozen membership."""
    wave = session.get(ReviewWave, wave_id)
    if wave is None:
        raise ValueError("review wave not found")
    if wave.status not in {WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED}:
        raise ValueError("wave is not resumable")
    wave.status = WAVE_STATUS_ACTIVE
    wave.paused_at = None
    if session_id:
        wave.active_session_id = session_id
    wave.updated_at = _now()
    if wave.active_session_id:
        study_session = session.get(StudySession, wave.active_session_id)
        if study_session is not None and study_session.status in {"active", "paused"}:
            study_session.status = "active"
            study_session.ended_at = None
            study_session.updated_at = wave.updated_at
    frozen = {
        item.node_uid
        for item in session.query(ReviewWaveItem)
        .filter(ReviewWaveItem.wave_id == wave.id)
        .all()
    }
    mergeable: list[str] = []
    if wave.wave_type == WAVE_TYPE_FORMAL:
        current_due = set(formal_due_node_uids(session, wave.palace_id))
        mergeable = sorted(current_due - frozen)
    return {
        "wave": wave_payload(wave),
        "mergeable_node_uids": mergeable,
        "mergeable_count": len(mergeable),
    }


def complete_formal_wave(
    session: Session,
    wave_id: str,
    *,
    allow_incomplete: bool = False,
) -> ReviewWave:
    wave = session.get(ReviewWave, wave_id)
    if wave is None:
        raise ValueError("review wave not found")
    items = session.query(ReviewWaveItem).filter(ReviewWaveItem.wave_id == wave_id).all()
    pending = [
        item
        for item in items
        if item.status not in {ITEM_RATED_DIRECT, ITEM_RATED_INHERITED, ITEM_DONE}
    ]
    if pending and not allow_incomplete:
        raise ValueError(
            f"wave has {len(pending)} unrated items; pause instead of complete"
        )
    now = _now()
    wave.status = WAVE_STATUS_COMPLETED
    wave.completed_at = now
    wave.active_session_id = None
    wave.rated_count = len(items) - len(pending)
    wave.updated_at = now
    for item in items:
        if item.status in {ITEM_RATED_DIRECT, ITEM_RATED_INHERITED}:
            item.status = ITEM_DONE
            item.updated_at = now
    return wave


def start_reinforcement_wave_session(
    session: Session, wave_id: str
) -> StudySession:
    wave = session.get(ReviewWave, wave_id)
    if wave is None or wave.wave_type != WAVE_TYPE_REINFORCEMENT:
        raise ValueError("reinforcement wave not found")
    if wave.status not in {WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED}:
        raise ValueError("reinforcement wave is closed")
    if wave.available_at is not None and wave.available_at > _now():
        raise ValueError("reinforcement wave is not available yet")
    if wave.active_session_id:
        existing = session.get(StudySession, wave.active_session_id)
        if (
            existing is not None
            and existing.scene == "reinforcement_review"
            and existing.status in {"active", "paused", "recovered"}
        ):
            wave.status = WAVE_STATUS_ACTIVE
            wave.paused_at = None
            existing.status = "active"
            existing.ended_at = None
            return existing
    palace = session.get(Palace, wave.palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    node_uids = frozen_node_uids(session, wave.id)
    if not node_uids:
        raise ValueError("reinforcement wave has no pending nodes")
    session_id = f"reinforcement-{uuid.uuid4()}"
    now = _now()
    study_session = StudySession(
        id=session_id,
        status="active",
        scene="reinforcement_review",
        target_type="palace",
        target_id=wave.palace_id,
        palace_id=wave.palace_id,
        title=f"强化复习 · {palace.manual_title or palace.title or '未命名宫殿'}",
        started_at=now,
        progress_json="{}",
        events_json="[]",
        summary_json=json.dumps(
            {
                "frozen_due_node_uids": node_uids,
                "wave_id": wave.id,
                "review_entry_mode": "reinforcement",
                "review_entry_label": "当天强化",
            },
            ensure_ascii=False,
        ),
    )
    session.add(study_session)
    wave.status = WAVE_STATUS_ACTIVE
    wave.frozen_at = wave.frozen_at or now
    wave.paused_at = None
    wave.active_session_id = session_id
    wave.updated_at = now
    session.flush()
    return study_session
