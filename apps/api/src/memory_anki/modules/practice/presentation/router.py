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
from memory_anki.modules.practice.application.round_state_service import (
    apply_round_action,
    get_or_create_active_round,
    get_round,
    rate_freestyle_round_unit,
    start_new_round,
)
from memory_anki.modules.practice.domain.schemas import (
    FreestyleQuestionAttemptCreate,
    FreestyleQuestionExplanationCreate,
    FreestyleQueueBuildRequest,
    FreestyleRoundActionRequest,
    FreestyleRoundActiveRequest,
    FreestyleRoundRatingRequest,
    FreestyleRoundStartRequest,
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
            round_id=data.round_id,
            completed_ids=list(data.completed_ids or []),
            hidden_ids=list(data.hidden_ids or []),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/rounds/active")
def api_freestyle_round_active(
    data: FreestyleRoundActiveRequest,
    session: Session = Depends(session_dep),
):
    try:
        return get_or_create_active_round(
            session,
            scope_key=data.scope_key,
            config=data.config,
            cards=list(data.cards or []),
            operation_id=data.operation_id,
            round_id=data.round_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/rounds/start")
def api_freestyle_round_start(
    data: FreestyleRoundStartRequest,
    session: Session = Depends(session_dep),
):
    try:
        return start_new_round(
            session,
            scope_key=data.scope_key,
            config=data.config,
            cards=list(data.cards or []),
            operation_id=data.operation_id,
            round_id=data.round_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/freestyle/rounds/{round_id}")
def api_get_freestyle_round(
    round_id: str,
    session: Session = Depends(session_dep),
):
    payload = get_round(session, round_id)
    if payload is None:
        raise HTTPException(status_code=400, detail="freestyle round not found")
    return payload


@router.post("/freestyle/rounds/{round_id}/actions")
def api_freestyle_round_action(
    round_id: str,
    data: FreestyleRoundActionRequest,
    session: Session = Depends(session_dep),
):
    try:
        return apply_round_action(
            session,
            round_id=round_id,
            action=data.action,
            operation_id=data.operation_id,
            expected_version=data.expected_version,
            card_id=data.card_id,
            occurrence_id=data.occurrence_id,
            encounter_id=data.encounter_id,
            cards=list(data.cards or []),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/rounds/{round_id}/ratings")
def api_freestyle_round_rating(
    round_id: str,
    data: FreestyleRoundRatingRequest,
    session: Session = Depends(session_dep),
):
    try:
        return rate_freestyle_round_unit(
            session,
            round_id=round_id,
            operation_id=data.operation_id,
            expected_version=data.expected_version,
            card_id=data.card_id,
            occurrence_id=data.occurrence_id,
            encounter_id=data.encounter_id,
            rating=data.rating,
            study_session_id=data.study_session_id,
            unit_id=data.unit_id,
            unit_revision=data.unit_revision,
            palace_batch=data.palace_batch,
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
