import logging
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.content.application.editor_state_service import (
    EditorStateConflictError,
    get_palace_editor_state,
)
from memory_anki.modules.content.application.palace_serializer import (
    palace_editor_meta_json,
)
from memory_anki.modules.content.application.palace_service import get_palace
from memory_anki.modules.content.presentation.errors import raise_not_found
from memory_anki.platform.persistence import SqlAlchemyUnitOfWork

router = APIRouter()
logger = logging.getLogger(__name__)


def _maybe_create_rolling_backup(*args, **kwargs):
    from memory_anki.modules.content.presentation import router as palace_router

    return palace_router.maybe_create_rolling_backup(*args, **kwargs)


def _save_palace_editor_state(*args, **kwargs):
    from memory_anki.modules.content.presentation import router as palace_router

    return palace_router.save_palace_editor_state(*args, **kwargs)


def _run_rolling_backup_after_response() -> None:
    try:
        _maybe_create_rolling_backup("rolling-editor-save")
    except Exception:  # noqa: BLE001 - backup must not fail an already committed edit
        logger.exception("rolling editor backup failed")


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
def api_update_editor(
    palace_id: int,
    data: dict,
    background_tasks: BackgroundTasks,
    s: Session = Depends(session_dep),
):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    try:
        state = _save_palace_editor_state(
            s,
            palace,
            data,
            uow=SqlAlchemyUnitOfWork(s),
        )
    except EditorStateConflictError as exc:
        raise HTTPException(status_code=409, detail={"code": "mindmap_conflict", "message": str(exc), "remoteSnapshot": exc.current_snapshot}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    background_tasks.add_task(_run_rolling_backup_after_response)
    return {
        "palace": palace_editor_meta_json(palace, s),
        **state,
    }
