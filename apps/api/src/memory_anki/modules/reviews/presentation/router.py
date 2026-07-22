from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.reviews.application.formal_review_service import (
    clear_formal_review_progress,
    complete_formal_review,
    formal_review_completion_summary,
    formal_review_session_payload,
    get_formal_review_progress,
    get_fsrs_completion,
    get_fsrs_load_forecast,
    get_fsrs_queue_payload,
    rate_out_of_scope_due_formal_review_nodes,
    rate_unrated_formal_review_nodes,
    resolve_formal_review_session,
    save_formal_review_progress,
    start_or_resume_formal_review,
)
from memory_anki.modules.reviews.application.node_memory_service import (
    get_completion_summary,
    get_palace_mastery_trend,
    get_palace_memory_projection,
    rate_nodes,
    undo_rating_operation,
)
from memory_anki.modules.reviews.application.review_metrics_service import (
    get_weekly_stats,
    list_recent_review_notes,
)
from memory_anki.modules.reviews.presentation.response_models import (
    MasteryTrendResponse,
    OverdueCountResponse,
    ReviewQueueResponse,
    SubmitReviewResponse,
)
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter(tags=["review"])


def raise_not_found(message: str = "not found") -> NoReturn:
    raise HTTPException(status_code=404, detail=message)


@router.get("/review/overdue-count", response_model=OverdueCountResponse)
def api_overdue(session: Session = Depends(session_dep)):
    return {"count": get_fsrs_queue_payload(session)["overdue_count"]}


@router.get("/review/stats/weekly")
def api_stats(session: Session = Depends(session_dep)):
    return get_weekly_stats(session)


@router.get("/review/notes")
def api_review_notes(limit: int = 20, session: Session = Depends(session_dep)):
    return {"items": list_recent_review_notes(session, limit)}


@router.get("/review/load-forecast")
def api_load_forecast(days: int = 7, session: Session = Depends(session_dep)):
    return get_fsrs_load_forecast(session, days)


@router.get("/review/palaces/{palace_id}/memory")
def api_palace_memory(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return {"item": get_palace_memory_projection(session, palace_id)}
    except ValueError as exc:
        raise_not_found(str(exc))


@router.get("/review/palaces/{palace_id}/memory/trend", response_model=MasteryTrendResponse)
def api_palace_mastery_trend(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return get_palace_mastery_trend(session, palace_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/review/palaces/{palace_id}/completion-summary")
def api_palace_completion_summary(
    palace_id: int,
    node_uids: str | None = None,
    session: Session = Depends(session_dep),
):
    try:
        selected = [item for item in (node_uids or "").split(",") if item]
        return {"item": get_completion_summary(session, palace_id, node_uids=selected or None)}
    except ValueError as exc:
        raise_not_found(str(exc))


@router.post("/review/palaces/{palace_id}/ratings")
def api_rate_palace_nodes(
    palace_id: int,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    operation_id = str(data.get("operation_id") or "").strip()
    study_session_id = str(data.get("study_session_id") or f"rating-{operation_id}").strip()
    try:
        return {
            "item": rate_nodes(
                session,
                palace_id=palace_id,
                node_uid=str(data.get("node_uid") or ""),
                rating=int(str(data.get("rating") or "")),
                study_session_id=study_session_id,
                operation_id=operation_id,
                rating_scope=str(data.get("rating_scope") or "subtree"),
                conflict_policy=str(data.get("conflict_policy") or "overwrite"),
                source_scene=str(data.get("source_scene") or "formal_review"),
                recall_round=str(data.get("recall_round") or "first"),
                rating_source=str(data.get("rating_source") or "manual"),
                inference_confidence=data.get("inference_confidence"),
                response_ms=data.get("response_ms"),
                hint_count=int(data.get("hint_count") or 0),
                retry_count=int(data.get("retry_count") or 0),
            )
        }
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/palaces/{palace_id}/ratings/{operation_id}/undo")
def api_undo_palace_rating(
    palace_id: int,
    operation_id: str,
    data: dict | None = None,
    session: Session = Depends(session_dep),
):
    try:
        result = undo_rating_operation(
            session,
            operation_id=operation_id,
            study_session_id=str((data or {}).get("study_session_id") or ""),
        )
        return {"item": result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/review/queue", response_model=ReviewQueueResponse)
def api_queue(session: Session = Depends(session_dep)):
    return get_fsrs_queue_payload(session)


@router.get("/review/chapter/{chapter_id}/queue", response_model=ReviewQueueResponse)
def api_chapter_queue(chapter_id: int, session: Session = Depends(session_dep)):
    return get_fsrs_queue_payload(session, chapter_id)


@router.post("/review/palaces/{palace_id}/sessions")
def api_start_formal_review_session(palace_id: int, data: dict | None = None, session: Session = Depends(session_dep)):
    payload = data or {}
    try:
        row = start_or_resume_formal_review(
            session,
            palace_id,
            chapter_id=int(payload["chapter_id"]) if payload.get("chapter_id") is not None else None,
            entry_mode=str(payload.get("entry_mode") or "") or None,
            branch_uid=str(payload.get("branch_uid") or "") or None,
        )
        return formal_review_session_payload(session, row)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/review/session/{session_id}")
def api_review_session(session_id: str, session: Session = Depends(session_dep)):
    try:
        return formal_review_session_payload(
            session, resolve_formal_review_session(session, session_id)
        )
    except ValueError as exc:
        raise_not_found(str(exc))


@router.get("/review/session/{session_id}/progress")
def api_review_progress(session_id: str, session: Session = Depends(session_dep)):
    try:
        return get_formal_review_progress(resolve_formal_review_session(session, session_id))
    except ValueError as exc:
        raise_not_found(str(exc))


@router.put("/review/session/{session_id}/progress")
def api_upsert_review_progress(
    session_id: str, data: dict, session: Session = Depends(session_dep)
):
    try:
        return save_formal_review_progress(
            session, resolve_formal_review_session(session, session_id), data
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/review/session/{session_id}/progress")
def api_delete_review_progress(session_id: str, session: Session = Depends(session_dep)):
    try:
        return clear_formal_review_progress(
            session, resolve_formal_review_session(session, session_id)
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/review/session/{session_id}/completion-summary")
def api_formal_review_completion_summary(session_id: str, session: Session = Depends(session_dep)):
    try:
        return {
            "item": formal_review_completion_summary(
                session, resolve_formal_review_session(session, session_id)
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/review/session/{session_id}/rate-unrated")
def api_rate_unrated_formal_review_nodes(
    session_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    """One-tap settlement scoring for still-unrated frozen-due nodes only."""
    try:
        return {
            "item": rate_unrated_formal_review_nodes(
                session,
                resolve_formal_review_session(session, session_id),
                rating=int(str(data.get("rating") or "")),
                operation_id=str(data.get("operation_id") or "").strip(),
            )
        }
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/session/{session_id}/rate-out-of-scope-due")
def api_rate_out_of_scope_due_formal_review_nodes(
    session_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    """One-tap rate palace due nodes outside this session's frozen scope (confirmed)."""
    try:
        return {
            "item": rate_out_of_scope_due_formal_review_nodes(
                session,
                resolve_formal_review_session(session, session_id),
                rating=int(str(data.get("rating") or "")),
                operation_id=str(data.get("operation_id") or "").strip(),
            )
        }
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/review/session/{session_id}/submit", response_model=SubmitReviewResponse)
def api_submit_session(
    session_id: str, data: dict, request: Request, session: Session = Depends(session_dep)
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        response = complete_formal_review(
            session,
            resolve_formal_review_session(session, session_id),
            duration_seconds=int(data.get("duration_seconds", 0)),
            completion_mode=str(data.get("completion_mode") or "manual_complete"),
            note=str(data.get("note") or ""),
            chapter_id=int(data["chapter_id"]) if data.get("chapter_id") is not None else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    mutation_store.save(mutation_identity, response)
    SqlAlchemyUnitOfWork(session).commit()
    return response


@router.get("/review/completions/{review_log_id}", response_model=SubmitReviewResponse)
def api_review_completion(review_log_id: int, session: Session = Depends(session_dep)):
    response = get_fsrs_completion(session, review_log_id)
    if response is None:
        raise_not_found("复习完成记录不存在。")
    return response


@router.get("/review", response_model=ReviewQueueResponse)
def api_reviews(session: Session = Depends(session_dep)):
    return get_fsrs_queue_payload(session)


@router.get("/review/{session_id}")
def api_review_item(session_id: str, session: Session = Depends(session_dep)):
    return api_review_session(session_id, session)


@router.post("/review/{session_id}/submit", response_model=SubmitReviewResponse)
def api_submit(
    session_id: str,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    return api_submit_session(session_id, data, request, session)
