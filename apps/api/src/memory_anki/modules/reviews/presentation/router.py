from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewSchedule
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palaces.api import (
    palace_json as palace_detail_json,
)
from memory_anki.modules.palaces.api import (
    palace_review_stages_json,
)
from memory_anki.modules.reviews.application.node_memory_service import (
    get_completion_summary,
    get_palace_memory_projection,
    rate_nodes,
    undo_rating_operation,
)
from memory_anki.modules.reviews.application.review_commands import (
    adjust_review_stage_command,
    spread_overdue_command,
    submit_review_command,
)
from memory_anki.modules.reviews.application.review_execution_service import (
    ReviewSubmitConflictError,
    detect_review_stage_progress_issues,
    get_review_completion,
)
from memory_anki.modules.reviews.application.review_metrics_service import (
    get_review_load_forecast,
    get_weekly_stats,
    list_recent_review_notes,
)
from memory_anki.modules.reviews.application.review_queue_service import (
    get_chapter_queue_payload,
    get_next_due_review,
    get_overdue_count,
    get_review_queue_payload,
    undo_spread_overdue,
)
from memory_anki.modules.reviews.application.review_repair_service import (
    preview_review_stage_progress_repair,
    repair_review_stage_progress,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_stage_labels,
    schedule_display_datetime,
)
from memory_anki.modules.reviews.application.stage_adjustment_service import (
    ReviewStageAdjustmentConflictError,
    ReviewStageAdjustmentNotFoundError,
    preview_review_stage_adjustment,
)
from memory_anki.modules.reviews.presentation.response_models import (
    OverdueCountResponse,
    ReviewQueueResponse,
    ReviewScheduleItem,
    ReviewStageAdjustmentPreviewRequest,
    ReviewStageAdjustmentRequest,
    ReviewStageAdjustmentResponse,
    SubmitReviewResponse,
)
from memory_anki.modules.sessions.api import (
    clear_review_progress,
    get_review_progress,
    upsert_review_progress,
)
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter(tags=["review"])


def raise_not_found(message: str = "not found") -> NoReturn:
    raise HTTPException(status_code=404, detail=message)


def active_schedule_by_id(session: Session, schedule_id: int) -> ReviewSchedule | None:
    return (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.id == schedule_id,
            Palace.deleted_at.is_(None),
        )
        .first()
    )

@router.post(
    "/review/palaces/{palace_id}/stage-adjustment/preview",
    response_model=ReviewStageAdjustmentResponse,
)
def api_preview_review_stage_adjustment(
    palace_id: int,
    data: ReviewStageAdjustmentPreviewRequest,
    session: Session = Depends(session_dep),
):
    try:
        return preview_review_stage_adjustment(
            session,
            palace_id,
            target_completed_count=data.target_completed_count,
            completed_at=data.completed_at,
            needs_practice=data.needs_practice,
        )
    except ReviewStageAdjustmentNotFoundError:
        raise_not_found("宫殿不存在。")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post(
    "/review/palaces/{palace_id}/stage-adjustment",
    response_model=ReviewStageAdjustmentResponse,
)
def api_apply_review_stage_adjustment(
    palace_id: int,
    data: ReviewStageAdjustmentRequest,
    request: Request,
    session: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        return adjust_review_stage_command(
            session,
            palace_id,
            data.model_dump(),
            uow=SqlAlchemyUnitOfWork(session),
            before_commit=lambda payload: mutation_store.save(
                mutation_identity,
                payload,
            ),
        )
    except ReviewStageAdjustmentNotFoundError:
        raise_not_found("宫殿不存在。")
    except ReviewStageAdjustmentConflictError as error:
        raise HTTPException(
            status_code=409,
            detail="复习进度已发生变化，请重新打开弹窗后再调整。",
        ) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

def chapter_json(chapter: Chapter | None) -> dict | None:
    if chapter is None:
        return None
    return {
        "id": chapter.id,
        "name": chapter.name,
        "subject_id": chapter.subject_id,
        "subject": (
            {"id": chapter.subject.id, "name": chapter.subject.name}
            if chapter.subject
            else None
        ),
    }


def schedule_json(schedule: ReviewSchedule, session: Session | None = None) -> dict:
    palace_data = palace_detail_json(schedule.palace, session) if schedule.palace else None
    if palace_data and session:
        stage_labels = get_algorithm_stage_labels(session)
        palace_data["stage_labels"] = stage_labels
        palace_data["review_stages"] = palace_review_stages_json(session, schedule.palace, stage_labels)
    completed_at = schedule.completed_at
    due_at = schedule_display_datetime(schedule, schedule.palace, session) if schedule.palace and session else None
    return {
        "id": schedule.id,
        "palace_id": schedule.palace_id,
        "scheduled_date": schedule.scheduled_date.isoformat(),
        "due_at": due_at.isoformat(timespec="minutes") if due_at else None,
        "interval_days": schedule.interval_days,
        "algorithm_used": schedule.algorithm_used,
        "completed": schedule.completed,
        "completed_at": completed_at.isoformat(timespec="minutes") if completed_at else None,
        "review_number": schedule.review_number,
        "review_type": schedule.review_type,
        "palace": palace_data,
    }


def grouped_schedule_json(group: dict, session: Session | None = None) -> dict:
    schedule = group["schedule"]
    return {
        **schedule_json(schedule, session),
        "schedule_count": group["schedule_count"],
        "overdue_schedule_count": group["overdue_schedule_count"],
        "next_due_date": group["next_due_date"].isoformat(),
    }


def queue_payload_json(payload: dict, session: Session | None = None) -> dict:
    return {
        "due_count": payload["due_count"],
        "later_today_count": payload["later_today_count"],
        "overdue_count": payload["overdue_count"],
        "smoothed_count": payload["smoothed_count"],
        "stats": payload["stats"],
        "chapter": chapter_json(payload.get("chapter")),
        "reviews": [grouped_schedule_json(group, session) for group in payload["reviews"]],
        "later_today_reviews": [
            grouped_schedule_json(group, session) for group in payload["later_today_reviews"]
        ],
    }


@router.get("/review/overdue-count", response_model=OverdueCountResponse)
def api_overdue(session: Session = Depends(session_dep)):
    return {"count": get_overdue_count(session)}


@router.get("/review/stats/weekly")
def api_stats(session: Session = Depends(session_dep)):
    return get_weekly_stats(session)


@router.get("/review/notes")
def api_review_notes(limit: int = 20, session: Session = Depends(session_dep)):
    return {"items": list_recent_review_notes(session, limit)}


@router.get("/review/load-forecast")
def api_load_forecast(days: int = 7, session: Session = Depends(session_dep)):
    return get_review_load_forecast(session, days)


@router.post("/review/spread-overdue")
def api_spread(data: dict, request: Request, session: Session = Depends(session_dep)):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    return spread_overdue_command(
        session,
        days=int(data.get("days", 7)),
        dry_run=bool(data.get("dry_run", False)),
        uow=SqlAlchemyUnitOfWork(session),
        before_commit=lambda response: mutation_store.save(
            mutation_identity, response
        ),
    )


@router.post("/review/spread-overdue/undo")
def api_spread_undo(session: Session = Depends(session_dep)):
    return {"ok": True, "restored": undo_spread_overdue(session)}


@router.get("/review/stage-progress-health")
def api_review_stage_progress_health(session: Session = Depends(session_dep)):
    return {"ok": True, **detect_review_stage_progress_issues(session)}


@router.post("/review/repair-stage-progress")
def api_repair_review_stage_progress(
    data: dict | None = None,
    session: Session = Depends(session_dep),
):
    if data and bool(data.get("dry_run")):
        return {"ok": True, **preview_review_stage_progress_repair(session)}
    result = repair_review_stage_progress(session, uow=SqlAlchemyUnitOfWork(session))
    return {"ok": True, **result}


@router.get("/review/palaces/{palace_id}/memory")
def api_palace_memory(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return {"item": get_palace_memory_projection(session, palace_id)}
    except ValueError as exc:
        raise_not_found(str(exc))


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
        return {"item": rate_nodes(
            session, palace_id=palace_id, node_uid=str(data.get("node_uid") or ""),
            rating=int(str(data.get("rating") or "")), study_session_id=study_session_id,
            operation_id=operation_id, rating_scope=str(data.get("rating_scope") or "subtree"),
            source_scene=str(data.get("source_scene") or "formal_review"),
        )}
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
            session, operation_id=operation_id,
            study_session_id=str((data or {}).get("study_session_id") or ""),
        )
        return {"item": result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/review/queue", response_model=ReviewQueueResponse)
def api_queue(session: Session = Depends(session_dep)):
    return queue_payload_json(get_review_queue_payload(session), session)


@router.get("/review/chapter/{chapter_id}/queue", response_model=ReviewQueueResponse)
def api_chapter_queue(chapter_id: int, session: Session = Depends(session_dep)):
    return queue_payload_json(get_chapter_queue_payload(session, chapter_id), session)


@router.get("/review/session/{schedule_id}", response_model=ReviewScheduleItem)
def api_review_session(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = active_schedule_by_id(session, schedule_id)
    if not schedule:
        raise_not_found()
    return schedule_json(schedule, session)


@router.get("/review/session/{schedule_id}/progress")
def api_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = active_schedule_by_id(session, schedule_id)
    if not schedule:
        raise_not_found()
    return {"progress": get_review_progress(session, schedule_id)}


@router.put("/review/session/{schedule_id}/progress")
def api_upsert_review_progress(schedule_id: int, data: dict, session: Session = Depends(session_dep)):
    schedule = active_schedule_by_id(session, schedule_id)
    if not schedule:
        raise_not_found()
    return {"progress": upsert_review_progress(session, schedule_id, schedule.palace_id, data)}


@router.delete("/review/session/{schedule_id}/progress")
def api_delete_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    clear_review_progress(session, schedule_id)
    return {"ok": True}


@router.post("/review/session/{schedule_id}/submit", response_model=SubmitReviewResponse)
def api_submit_session(
    schedule_id: int,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response

    try:
        response = submit_review_command(
            session,
            schedule_id,
            data,
            uow=SqlAlchemyUnitOfWork(session),
            before_commit=lambda payload: mutation_store.save(mutation_identity, payload),
        )
    except ReviewSubmitConflictError as error:
        raise HTTPException(
            status_code=409,
            detail={"code": "review_submit_conflict", "message": str(error)},
        ) from error
    if response is None:
        raise_not_found()
    return response


@router.get("/review/completions/{review_log_id}", response_model=SubmitReviewResponse)
def api_review_completion(review_log_id: int, session: Session = Depends(session_dep)):
    response = get_review_completion(session, review_log_id)
    if response is None:
        raise_not_found("复习完成记录不存在。")
    next_schedule = get_next_due_review(
        session,
        chapter_id=response.get("chapter_id"),
    )
    return {
        "ok": True,
        "completion_mode": "manual_complete",
        "score": 5,
        "next_id": next_schedule.id if next_schedule else None,
        **response,
    }


@router.get("/review", response_model=ReviewQueueResponse)
def api_reviews(session: Session = Depends(session_dep)):
    return queue_payload_json(get_review_queue_payload(session), session)


@router.get("/review/{schedule_id}", response_model=ReviewScheduleItem)
def api_review_item(schedule_id: int, session: Session = Depends(session_dep)):
    return api_review_session(schedule_id, session)


@router.post("/review/{schedule_id}/submit", response_model=SubmitReviewResponse)
def api_submit(
    schedule_id: int,
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    return api_submit_session(schedule_id, data, request, session)
