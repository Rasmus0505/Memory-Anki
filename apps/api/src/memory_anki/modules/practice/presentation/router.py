from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.practice.application.feed_service import (
    FREESTYLE_RANGE_ALL,
    build_freestyle_feed,
)
from memory_anki.modules.practice.application.history_service import (
    build_history_summary,
    create_question_attempt,
    create_question_explanation,
    list_question_attempts,
    list_question_explanations,
)
from memory_anki.modules.practice.application.queue_service import build_freestyle_queue
from memory_anki.modules.practice.application.temporary_marks import (
    clear_palace_temporary_marks,
    get_palace_temporary_marks,
    replace_palace_temporary_marks,
)
from memory_anki.modules.practice.domain.schemas import (
    FreestyleQuestionAttemptCreate,
    FreestyleQuestionExplanationCreate,
    FreestyleQueueBuildRequest,
    FreestyleTemporaryMarksReplaceRequest,
)

router = APIRouter(tags=["freestyle"])


@router.get("/freestyle/feed")
def api_freestyle_feed(
    range_: str = Query(FREESTYLE_RANGE_ALL, alias="range"),
    palace_ids: str | None = Query(None),
    content_types: str | None = Query(None),
    session: Session = Depends(session_dep),
):
    try:
        return build_freestyle_feed(
            session,
            range_value=range_,
            palace_ids_value=palace_ids,
            content_types_value=content_types,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/queue/build")
def api_freestyle_queue_build(
    data: FreestyleQueueBuildRequest,
    session: Session = Depends(session_dep),
):
    try:
        return build_freestyle_queue(
            session,
            config_raw=data.config,
            operation_id=data.operation_id,
            completed_ids=list(data.completed_ids or []),
            hidden_ids=list(data.hidden_ids or []),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/question-attempts")
def api_create_freestyle_question_attempt(
    data: FreestyleQuestionAttemptCreate,
    session: Session = Depends(session_dep),
):
    try:
        return {
            "item": create_question_attempt(
                session,
                data.model_dump(exclude_unset=True, exclude_none=False),
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/freestyle/question-attempts")
def api_list_freestyle_question_attempts(
    limit: int = Query(50),
    palace_id: int | None = Query(None),
    question_id: int | None = Query(None),
    mode: str | None = Query(None),
    session: Session = Depends(session_dep),
):
    try:
        return {
            "items": list_question_attempts(
                session,
                limit=limit,
                palace_id=palace_id,
                question_id=question_id,
                mode=mode,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/question-explanations")
def api_create_freestyle_question_explanation(
    data: FreestyleQuestionExplanationCreate,
    session: Session = Depends(session_dep),
):
    try:
        return {
            "item": create_question_explanation(
                session,
                data.model_dump(exclude_unset=True, exclude_none=False),
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/freestyle/question-explanations")
def api_list_freestyle_question_explanations(
    limit: int = Query(50),
    palace_id: int | None = Query(None),
    question_id: int | None = Query(None),
    session: Session = Depends(session_dep),
):
    return {
        "items": list_question_explanations(
            session,
            limit=limit,
            palace_id=palace_id,
            question_id=question_id,
        )
    }


@router.get("/freestyle/history-summary")
def api_freestyle_history_summary(session: Session = Depends(session_dep)):
    return build_history_summary(session)


@router.get("/freestyle/temporary-marks/{palace_id}")
def api_get_temporary_marks(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return get_palace_temporary_marks(session, palace_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/freestyle/temporary-marks/{palace_id}")
def api_replace_temporary_marks(
    palace_id: int,
    data: FreestyleTemporaryMarksReplaceRequest,
    session: Session = Depends(session_dep),
):
    try:
        return replace_palace_temporary_marks(
            session,
            palace_id=palace_id,
            node_uids=list(data.node_uids or []),
            unify_progress=bool(data.unify_progress),
            operation_id=data.operation_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/freestyle/temporary-marks/{palace_id}")
def api_clear_temporary_marks(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return clear_palace_temporary_marks(session, palace_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
