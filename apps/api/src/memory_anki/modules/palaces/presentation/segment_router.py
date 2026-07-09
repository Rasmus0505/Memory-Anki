from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palaces.application.focus_service import (
    parse_focus_node_uids,
    set_focus_node_uids,
    toggle_focus_node_uid,
)
from memory_anki.modules.palaces.application.palace_serializer import palace_json
from memory_anki.modules.palaces.application.palace_service import get_palace
from memory_anki.modules.palaces.application.segment_review_service import (
    build_palace_default_segment_summary,
    build_segment_editor_doc,
    list_palace_segments,
    segment_summary_json,
)
from memory_anki.modules.palaces.application.segment_service import (
    create_palace_segment,
    delete_palace_segment,
    get_palace_segment,
    update_palace_segment,
)
from memory_anki.modules.palaces.presentation.errors import raise_not_found
from memory_anki.modules.persistence.application.idempotency import (
    get_idempotent_response,
    save_idempotent_response,
)

router = APIRouter()


def _maybe_create_rolling_backup(*args, **kwargs):
    from memory_anki.modules.palaces.presentation import router as palace_router

    return palace_router.maybe_create_rolling_backup(*args, **kwargs)


@router.get("/palaces/{palace_id}/segments")
def api_list_segments(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    default_segment = build_palace_default_segment_summary(s, palace)
    return {"items": list_palace_segments(s, palace, default_segment_payload=default_segment)}


@router.post("/palaces/{palace_id}/segments")
def api_create_segment(
    palace_id: int,
    data: dict,
    request: Request,
    s: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(s, request)
    if existing_response is not None:
        return existing_response
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    segment = create_palace_segment(s, palace, data)
    _maybe_create_rolling_backup("rolling-create-palace-segment")
    response = {"item": segment_summary_json(s, segment)}
    save_idempotent_response(s, request, response)
    return response


@router.put("/palace-segments/{segment_id}")
def api_update_segment(segment_id: int, data: dict, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment:
        raise_not_found()
    updated = update_palace_segment(s, segment, data)
    _maybe_create_rolling_backup("rolling-update-palace-segment")
    return {"item": segment_summary_json(s, updated)}


@router.put("/palaces/{palace_id}/practice-flag")
def api_update_palace_practice_flag(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    palace.needs_practice = bool(data.get("needs_practice", False))
    s.commit()
    s.refresh(palace)
    return {"item": palace_json(palace, s)}


@router.put("/palaces/{palace_id}/focus-nodes/{node_uid}")
def api_toggle_palace_focus_node(
    palace_id: int,
    node_uid: str,
    data: dict | None = None,
    s: Session = Depends(session_dep),
):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    normalized_uid = str(node_uid or "").strip()
    if data is not None and "focused" in data:
        current_uids = parse_focus_node_uids(palace)
        target_focused = bool(data.get("focused"))
        if not normalized_uid:
            focus_node_uids = current_uids
            focused = False
        elif target_focused:
            focus_node_uids = set_focus_node_uids(palace, [*current_uids, normalized_uid])
            focused = True
        else:
            focus_node_uids = set_focus_node_uids(
                palace,
                [uid for uid in current_uids if uid != normalized_uid],
            )
            focused = False
    else:
        focus_node_uids, focused = toggle_focus_node_uid(palace, node_uid)
    s.commit()
    s.refresh(palace)
    return {
        "ok": True,
        "palace_id": palace.id,
        "node_uid": node_uid,
        "focused": focused,
        "focus_node_uids": focus_node_uids,
        "focus_count": len(focus_node_uids),
        "item": palace_json(palace, s),
    }


@router.delete("/palace-segments/{segment_id}")
def api_delete_segment(segment_id: int, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment:
        raise_not_found()
    delete_palace_segment(s, segment)
    _maybe_create_rolling_backup("rolling-delete-palace-segment")
    return {"ok": True}


@router.get("/palace-segments/{segment_id}")
def api_get_segment(segment_id: int, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment or not segment.palace:
        raise_not_found()
    return {
        "item": segment_summary_json(s, segment),
        "palace": palace_json(segment.palace, s),
        "editor_doc": build_segment_editor_doc(segment.palace, segment),
    }
