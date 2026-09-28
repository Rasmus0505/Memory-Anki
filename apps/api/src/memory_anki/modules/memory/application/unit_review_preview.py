"""Read-only unit preview for rendering a feed card before it becomes active.

Same shape as a unit review session payload so the client can draw the real map,
but with no study session, no encounter and no reconcile: a GET that never writes.
Opening the encounter stays the job of the session start command on activation.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.mindmap_document.api import deserialize_editor_payload

from .unit_review_projection import _active_unit_key, resolve_unit_definitions, unit_payload


def get_unit_review_preview(session: Session, unit_id: str) -> dict[str, Any]:
    state = session.get(ReviewUnitState, unit_id)
    if state is None or not state.active:
        raise ValueError("review unit not found")
    palace = session.get(Palace, state.palace_id)
    if palace is None or palace.deleted_at is not None or palace.archived:
        raise ValueError("review unit not found")
    _, definitions = resolve_unit_definitions(session, state.palace_id)
    definition = next(
        (
            item
            for item in definitions
            if _active_unit_key(item.anchor_uid, item.unit_kind)
            == _active_unit_key(state.anchor_uid, state.unit_kind)
        ),
        None,
    )
    unit = unit_payload(state, definition)
    unit.update(
        {
            "session_status": "pending",
            "retry_count": 0,
            "hard_count": 0,
            "again_count": 0,
            "final_rating": None,
            "encounter": None,
        }
    )
    return {
        "id": f"preview:{state.id}",
        "palace_id": state.palace_id,
        "title": palace.title or "",
        "palace": {
            "id": palace.id,
            "title": palace.title or "",
            "editor_doc": deserialize_editor_payload(palace.editor_doc, {}),
        },
        "status": "preview",
        "started_at": None,
        "ended_at": None,
        "units": [unit],
        "pending_unit_count": 1,
        "completed_unit_count": 0,
    }


__all__ = ["get_unit_review_preview"]
