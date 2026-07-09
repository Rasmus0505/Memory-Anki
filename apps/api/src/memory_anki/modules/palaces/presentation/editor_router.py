import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.core.concurrency_limits import concurrency_slot
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.mindmap.application.editor_state_service import (
    EditorStateConflictError,
    get_palace_editor_state,
)
from memory_anki.modules.palaces.application.focus_service import (
    build_focus_editor_doc,
    parse_focus_node_uids,
)
from memory_anki.modules.palaces.application.mindmap_ai_split_service import (
    MindMapAiSplitError,
    split_palace_editor_doc_with_ai,
)
from memory_anki.modules.palaces.application.palace_serializer import (
    palace_editor_meta_json,
    palace_json,
)
from memory_anki.modules.palaces.application.palace_service import get_palace
from memory_anki.modules.palaces.presentation.errors import raise_not_found
from memory_anki.modules.settings.application.ai_model_registry import (
    normalize_ai_runtime_options,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _maybe_create_rolling_backup(*args, **kwargs):
    from memory_anki.modules.palaces.presentation import router as palace_router

    return palace_router.maybe_create_rolling_backup(*args, **kwargs)


def _save_palace_editor_state(*args, **kwargs):
    from memory_anki.modules.palaces.presentation import router as palace_router

    return palace_router.save_palace_editor_state(*args, **kwargs)


@router.get("/palaces/{palace_id}/editor")
def api_get_editor(palace_id: int, s: Session = Depends(session_dep)):
    started_at = time.perf_counter()
    lookup_started_at = started_at
    palace = get_palace(s, palace_id)
    lookup_ms = round((time.perf_counter() - lookup_started_at) * 1000, 2)
    if not palace:
        raise_not_found()
    meta_started_at = time.perf_counter()
    palace_meta = palace_editor_meta_json(palace, s)
    meta_ms = round((time.perf_counter() - meta_started_at) * 1000, 2)
    editor_state_started_at = time.perf_counter()
    editor_state = get_palace_editor_state(palace)
    editor_state_ms = round((time.perf_counter() - editor_state_started_at) * 1000, 2)
    total_ms = round((time.perf_counter() - started_at) * 1000, 2)
    logger.info(
        "palace editor payload prepared palace_id=%s lookup_ms=%s meta_ms=%s editor_state_ms=%s total_ms=%s root_child_count=%s",
        palace_id,
        lookup_ms,
        meta_ms,
        editor_state_ms,
        total_ms,
        len((editor_state.get("editor_doc") or {}).get("root", {}).get("children", []))
        if isinstance(editor_state.get("editor_doc"), dict)
        else None,
    )
    return {
        "palace": palace_meta,
        **editor_state,
    }


@router.put("/palaces/{palace_id}/editor")
def api_update_editor(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    try:
        state = _save_palace_editor_state(s, palace, data)
    except EditorStateConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _maybe_create_rolling_backup("rolling-editor-save")
    return {
        "palace": palace_json(palace, s),
        **state,
    }


@router.get("/palaces/{palace_id}/focus-session")
def api_get_focus_session(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    focus_node_uids = parse_focus_node_uids(palace)
    return {
        "palace": palace_json(palace, s),
        "editor_doc": build_focus_editor_doc(palace),
        "focus_node_uids": focus_node_uids,
        "focus_count": len(focus_node_uids),
    }


@router.post("/palaces/{palace_id}/editor/ai-split")
def api_ai_split_editor_node(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    try:
        with concurrency_slot("ai_generation", rate_limited=True):
            result = split_palace_editor_doc_with_ai(
                s,
                palace,
                data.get("editor_doc"),
                data.get("target_node_uid"),
                normalize_ai_runtime_options(data.get("ai_options")),
            )
    except MindMapAiSplitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "ok": True,
        "editor_doc": result.editor_doc,
        "generated_children_count": result.generated_children_count,
        "reassigned_existing_children_count": result.reassigned_existing_children_count,
        "model": result.model,
        "ai_call_log_id": getattr(result, "ai_call_log_id", None),
        "resolved_ai": getattr(result, "resolved_ai", None),
        "review_preview": getattr(result, "review_preview", None),
    }
