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
from memory_anki.modules.memory.application.wave_policy import (
    ITEM_DONE,
    ITEM_PENDING,
    ITEM_PENDING_REINFORCEMENT,
    ITEM_RATED_DIRECT,
    ITEM_RATED_INHERITED,
    WAVE_STATUS_ACTIVE,
    WAVE_STATUS_CANCELLED,
    WAVE_STATUS_COMPLETED,
    WAVE_STATUS_PAUSED,
    WAVE_STATUS_SCHEDULED,
    WAVE_TYPE_FORMAL,
    WAVE_TYPE_REINFORCEMENT,
)
from memory_anki.modules.memory.application.wave_queries import (
    formal_due_node_uids,
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


def _normalize_client_source(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if normalized == "desktop":
        return "desktop"
    if normalized in {"pwa", "mobile"}:
        return "pwa"
    return None


def start_reinforcement_wave_session(
    session: Session,
    wave_id: str,
    *,
    client_source: str | None = None,
) -> StudySession:
    wave = session.get(ReviewWave, wave_id)
    if wave is None or wave.wave_type != WAVE_TYPE_REINFORCEMENT:
        raise ValueError("reinforcement wave not found")
    if wave.status not in {WAVE_STATUS_SCHEDULED, WAVE_STATUS_ACTIVE, WAVE_STATUS_PAUSED}:
        raise ValueError("reinforcement wave is closed")
    if wave.available_at is not None and wave.available_at > _now():
        raise ValueError("reinforcement wave is not available yet")
    normalized_client_source = _normalize_client_source(client_source)
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
            if normalized_client_source is not None:
                try:
                    summary = json.loads(existing.summary_json or "{}")
                except (TypeError, json.JSONDecodeError):
                    summary = {}
                if not isinstance(summary, dict):
                    summary = {}
                if _normalize_client_source(summary.get("client_source")) is None:
                    summary["client_source"] = normalized_client_source
                    existing.summary_json = json.dumps(summary, ensure_ascii=False)
            return existing
    palace = session.get(Palace, wave.palace_id)
    if palace is None or palace.deleted_at is not None:
        raise ValueError("palace not found")
    # Only pending reinforcement membership counts; rated/done shells are not startable.
    pending_items = (
        session.query(ReviewWaveItem)
        .filter(
            ReviewWaveItem.wave_id == wave.id,
            ReviewWaveItem.status.in_([ITEM_PENDING, ITEM_PENDING_REINFORCEMENT]),
        )
        .order_by(ReviewWaveItem.node_uid.asc())
        .all()
    )
    node_uids = [item.node_uid for item in pending_items]
    if not node_uids:
        # Ghost empty waves left after node reassignment / abandoned sessions.
        wave.status = WAVE_STATUS_CANCELLED
        wave.completed_at = _now()
        wave.active_session_id = None
        wave.item_count = (
            session.query(ReviewWaveItem).filter(ReviewWaveItem.wave_id == wave.id).count()
        )
        wave.updated_at = wave.completed_at
        raise ValueError("reinforcement wave has no pending nodes")
    session_id = f"reinforcement-{uuid.uuid4()}"
    now = _now()
    summary_payload: dict[str, Any] = {
        "frozen_due_node_uids": node_uids,
        "wave_id": wave.id,
        "review_entry_mode": "reinforcement",
        "review_entry_label": "本轮补刷",
    }
    if normalized_client_source is not None:
        summary_payload["client_source"] = normalized_client_source
    study_session = StudySession(
        id=session_id,
        status="active",
        scene="reinforcement_review",
        target_type="palace",
        target_id=wave.palace_id,
        palace_id=wave.palace_id,
        title=f"本轮补刷 · {palace.manual_title or palace.title or '未命名宫殿'}",
        started_at=now,
        progress_json="{}",
        events_json="[]",
        summary_json=json.dumps(summary_payload, ensure_ascii=False),
    )
    session.add(study_session)
    wave.status = WAVE_STATUS_ACTIVE
    wave.frozen_at = wave.frozen_at or now
    wave.paused_at = None
    wave.active_session_id = session_id
    wave.updated_at = now
    session.flush()
    return study_session
