"""Post-settlement amendment: reopen a completed formal review for re-rate."""

from __future__ import annotations

import json
from typing import Any

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
    WAVE_STATUS_COMPLETED,
)

ACTIVE_REVIEW_STATUSES = frozenset({"active", "paused", "recovered"})
INACTIVE_REVIEW_MESSAGE = "formal review session is not active"


def _json(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        data = json.loads(value)
    except (TypeError, json.JSONDecodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def reopen_formal_review_for_amendment(
    session: Session, row: StudySession
) -> StudySession:
    """Re-open a completed formal session so the learner can amend ratings.

    Settlement may be wrong (bulk mis-score, accidental rating). While the user
    is still on the same session page they should be able to undo/re-rate and
    run settlement again. Rebuilding clears the receipt so the next complete
    recomputes mastery / next-review; the previous ReviewLog id is kept for
    in-place update instead of a duplicate log row.
    """
    if row.status in ACTIVE_REVIEW_STATUSES:
        if row.status == "recovered":
            row.status = "active"
            row.ended_at = None
            row.updated_at = utc_now_naive()
        return row
    if row.status != "completed" or row.scene not in {"review", "reinforcement_review"}:
        raise ValueError(INACTIVE_REVIEW_MESSAGE)

    existing = _json(row.summary_json)
    receipt = existing.get("completion_receipt")
    if isinstance(receipt, dict):
        log_id = receipt.get("review_log_id")
        if log_id is not None:
            existing["amendable_review_log_id"] = log_id
        existing.pop("completion_receipt", None)

    now = utc_now_naive()
    row.status = "active"
    row.ended_at = None
    # Column is NOT NULL; blank while the amended session is open again.
    row.completion_method = ""
    row.summary_json = json.dumps(existing, ensure_ascii=False)
    row.updated_at = now

    wave_id = existing.get("wave_id")
    if wave_id:
        wave = session.get(ReviewWave, str(wave_id))
        if wave is not None and wave.status == WAVE_STATUS_COMPLETED:
            wave.status = WAVE_STATUS_ACTIVE
            wave.completed_at = None
            wave.active_session_id = str(row.id)
            wave.updated_at = now
            items = (
                session.query(ReviewWaveItem)
                .filter(ReviewWaveItem.wave_id == wave.id)
                .all()
            )
            # complete_formal_wave collapses rated items to ITEM_DONE; reverse so
            # undo/reconcile can restore pending membership again.
            for item in items:
                if item.status != ITEM_DONE:
                    continue
                if item.evidence_origin in {"batch_inherited", "inherited"}:
                    item.status = ITEM_RATED_INHERITED
                elif item.rating is not None:
                    item.status = ITEM_RATED_DIRECT
                else:
                    item.status = ITEM_PENDING
                item.updated_at = now
    session.flush()
    return row
