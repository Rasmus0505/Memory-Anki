from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.memory.api import domain_error_detail
from memory_anki.modules.practice.application.bedtime_round_service import (
    append_bedtime_review,
    bedtime_candidates,
    rate_bedtime_card,
)
from memory_anki.modules.practice.application.feed_service import (
    FREESTYLE_RANGE_ALL,
    build_freestyle_feed,
)
from memory_anki.modules.practice.application.freestyle_overview import build_freestyle_overview
from memory_anki.modules.practice.application.history_service import (
    build_history_summary,
    create_question_attempt,
    create_question_explanation,
    list_question_attempts,
    list_question_explanations,
)
from memory_anki.modules.practice.application.queue_service import (
    build_freestyle_queue,
    build_tomorrow_due_summary,
)
from memory_anki.modules.practice.application.rating_intents import (
    clear_rating_intent,
    list_rating_intents,
    put_rating_intent,
)
from memory_anki.modules.practice.application.round_overlay_service import (
    drop_overlay_quiz_for_palaces,
    ensure_overlay_quiz,
    progress_overlay_quiz,
    read_round_question_badge,
    set_overlay_skipped_palaces,
)
from memory_anki.modules.practice.application.round_state_service import (
    apply_round_action,
    get_or_create_active_round,
    get_round,
    rate_freestyle_round_unit,
    read_workspace_active_round,
    start_new_round,
)
from memory_anki.modules.practice.domain.schemas import (
    FreestyleBedtimeAppendRequest,
    FreestyleBedtimeRatingRequest,
    FreestyleOverlayQuizDropPalacesRequest,
    FreestyleOverlayQuizEnsureRequest,
    FreestyleOverlayQuizProgressRequest,
    FreestyleOverlayQuizSkipPalacesRequest,
    FreestyleQuestionAttemptCreate,
    FreestyleQuestionExplanationCreate,
    FreestyleQueueBuildRequest,
    FreestyleRatingIntentRequest,
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
            study_window=bool(data.study_window),
            tz_name=data.tz,
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
            workspace=data.workspace,
            replan=bool(data.replan),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/freestyle/rounds/active")
def api_freestyle_round_active_read(
    workspace: str = Query("primary"),
    session: Session = Depends(session_dep),
):
    """Read-only workspace round for 同步进度. Does not create or append."""
    payload = read_workspace_active_round(session, workspace=workspace)
    if payload is None:
        raise HTTPException(status_code=404, detail="freestyle round not found")
    return payload


@router.get("/freestyle/overview")
def api_freestyle_overview(
    date_value: str | None = Query(None, alias="date"),
    tz: str | None = Query(None),
    round_id: str | None = Query(None),
    session: Session = Depends(session_dep),
):
    """Read-only start-page overview. Computed live, never from a snapshot."""
    try:
        return build_freestyle_overview(
            session,
            day_text=date_value,
            tz_name=tz,
            round_id=round_id,
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
            workspace=data.workspace,
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


@router.get("/freestyle/rounds/{round_id}/question-ratings")
def api_freestyle_round_question_ratings(
    round_id: str,
    session: Session = Depends(session_dep),
):
    """This round's rating badge pair, for 关联题目.

    Read-only on purpose: opening a question window must not write the round, or
    its version would move under the study loop and 409 the next rating.
    ``question_pending_ids`` are the only questions that may say 「本轮尚未复习」.
    """
    ratings, pending = read_round_question_badge(session, round_id=round_id)
    return {
        "round_id": round_id,
        "question_node_ratings": ratings,
        "question_pending_ids": pending,
    }


@router.post("/freestyle/rounds/{round_id}/overlay-quiz/ensure")
def api_freestyle_overlay_quiz_ensure(
    round_id: str,
    data: FreestyleOverlayQuizEnsureRequest,
    session: Session = Depends(session_dep),
):
    try:
        return ensure_overlay_quiz(
            session,
            round_id=round_id,
            operation_id=data.operation_id,
            expected_version=data.expected_version,
            config=data.config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/rounds/{round_id}/overlay-quiz/progress")
def api_freestyle_overlay_quiz_progress(
    round_id: str,
    data: FreestyleOverlayQuizProgressRequest,
    session: Session = Depends(session_dep),
):
    try:
        return progress_overlay_quiz(
            session,
            round_id=round_id,
            operation_id=data.operation_id,
            expected_version=data.expected_version,
            current_index=data.current_index,
            completed_ids=list(data.completed_ids or []),
            states=data.states,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/rounds/{round_id}/overlay-quiz/skip-palaces")
def api_freestyle_overlay_quiz_skip_palaces(
    round_id: str,
    data: FreestyleOverlayQuizSkipPalacesRequest,
    session: Session = Depends(session_dep),
):
    try:
        return set_overlay_skipped_palaces(
            session,
            round_id=round_id,
            operation_id=data.operation_id,
            expected_version=data.expected_version,
            palace_ids=list(data.palace_ids or []),
            skipped=data.skipped,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/freestyle/rounds/{round_id}/overlay-quiz/drop-palaces")
def api_freestyle_overlay_quiz_drop_palaces(
    round_id: str,
    data: FreestyleOverlayQuizDropPalacesRequest,
    session: Session = Depends(session_dep),
):
    try:
        return drop_overlay_quiz_for_palaces(
            session,
            round_id=round_id,
            operation_id=data.operation_id,
            expected_version=data.expected_version,
            palace_ids=list(data.palace_ids or []),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
            partial_settlement=data.partial_settlement,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/freestyle/rounds/{round_id}/rating-intents")
def api_list_rating_intents(
    round_id: str,
    session: Session = Depends(session_dep),
):
    return {"items": list_rating_intents(session, round_id=round_id)}


@router.put("/freestyle/rounds/{round_id}/rating-intents/{card_id}")
def api_put_rating_intent(
    round_id: str,
    card_id: str,
    data: FreestyleRatingIntentRequest,
    session: Session = Depends(session_dep),
):
    try:
        return {
            "item": put_rating_intent(
                session,
                round_id=round_id,
                card_id=card_id,
                operation_id=data.operation_id,
                rating=data.rating,
                failure=data.failure,
                payload=data.payload,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/freestyle/rounds/{round_id}/rating-intents/{card_id}")
def api_clear_rating_intent(
    round_id: str,
    card_id: str,
    operation_id: str = Query(..., min_length=1, max_length=128),
    session: Session = Depends(session_dep),
):
    return {
        "cleared": clear_rating_intent(
            session,
            round_id=round_id,
            card_id=card_id,
            operation_id=operation_id,
        )
    }


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
            intent_sequence=data.intent_sequence,
            study_session_id=data.study_session_id,
            unit_id=data.unit_id,
            unit_revision=data.unit_revision,
            palace_batch=data.palace_batch,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=domain_error_detail(exc)) from exc


@router.get("/freestyle/rounds/{round_id}/bedtime/candidates")
def api_freestyle_bedtime_candidates(
    round_id: str,
    session: Session = Depends(session_dep),
):
    try:
        return bedtime_candidates(session, round_id=round_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=domain_error_detail(exc)) from exc


@router.post("/freestyle/rounds/{round_id}/bedtime")
def api_freestyle_bedtime_append(
    round_id: str,
    data: FreestyleBedtimeAppendRequest,
    session: Session = Depends(session_dep),
):
    try:
        return append_bedtime_review(
            session,
            round_id=round_id,
            operation_id=data.operation_id,
            expected_version=data.expected_version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=domain_error_detail(exc)) from exc


@router.post("/freestyle/rounds/{round_id}/bedtime/ratings")
def api_freestyle_bedtime_rating(
    round_id: str,
    data: FreestyleBedtimeRatingRequest,
    session: Session = Depends(session_dep),
):
    try:
        return rate_bedtime_card(
            session,
            round_id=round_id,
            operation_id=data.operation_id,
            expected_version=data.expected_version,
            card_id=data.card_id,
            rating=data.rating,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=domain_error_detail(exc)) from exc


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


@router.get("/freestyle/tomorrow-due")
def api_freestyle_tomorrow_due(session: Session = Depends(session_dep)):
    return build_tomorrow_due_summary(session)
