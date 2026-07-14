from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.ai_learning.application.service import (
    execute_run,
    list_runs,
    preview_run,
    purge_run,
    set_application_status,
    set_deleted,
    set_feedback,
    set_item_decision,
)
from memory_anki.modules.ai_learning.domain.schemas import (
    AiRunApplication,
    AiRunDraft,
    AiRunFeedback,
    AiRunItemDecision,
)
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog

router = APIRouter(prefix="/ai-learning", tags=["ai-learning"])


@router.post("/preview")
def api_preview_run(data: AiRunDraft, session: Session = Depends(session_dep)):
    return {"preview": preview_run(data, SettingsPromptCatalog(session))}


@router.post("/runs")
def api_execute_run(data: AiRunDraft, session: Session = Depends(session_dep)):
    return {
        "item": execute_run(
            session,
            data,
            SettingsAiRuntimeProvider(session),
            SettingsPromptCatalog(session),
        )
    }


@router.get("/runs")
def api_list_runs(
    review_session_id: int | None = Query(default=None),
    palace_id: int | None = Query(default=None),
    thread_id: str | None = Query(default=None),
    include_deleted: bool = Query(default=False),
    session: Session = Depends(session_dep),
):
    return {
        "items": list_runs(
            session,
            review_session_id=review_session_id,
            palace_id=palace_id,
            thread_id=thread_id,
            include_deleted=include_deleted,
        )
    }


@router.patch("/runs/{run_id}/feedback")
def api_set_feedback(
    run_id: str,
    data: AiRunFeedback,
    session: Session = Depends(session_dep),
):
    try:
        return {"item": set_feedback(session, run_id, data.feedback)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/runs/{run_id}/application")
def api_set_application(
    run_id: str,
    data: AiRunApplication,
    session: Session = Depends(session_dep),
):
    try:
        return {"item": set_application_status(session, run_id, data.status, data.result)}
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/runs/{run_id}")
def api_delete_run(run_id: str, session: Session = Depends(session_dep)):
    try:
        return {"item": set_deleted(session, run_id, True)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/restore")
def api_restore_run(run_id: str, session: Session = Depends(session_dep)):
    try:
        return {"item": set_deleted(session, run_id, False)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/runs/{run_id}/purge", status_code=204)
def api_purge_run(run_id: str, session: Session = Depends(session_dep)):
    try:
        purge_run(session, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(status_code=204)


@router.patch("/runs/{run_id}/items/{item_id}")
def api_set_item_decision(
    run_id: str,
    item_id: str,
    data: AiRunItemDecision,
    session: Session = Depends(session_dep),
):
    try:
        return {"item": set_item_decision(session, run_id, item_id, data.decision)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
