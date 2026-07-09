from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceMiniPalace,
    PalaceSegment,
    ReviewSchedule,
)
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.persistence.application.idempotency import (
    get_idempotent_response,
    save_idempotent_response,
)
from memory_anki.modules.sessions.application.session_progress_service import (
    clear_focus_practice_progress,
    clear_mini_practice_progress,
    clear_practice_progress,
    clear_review_progress,
    clear_segment_practice_progress,
    get_focus_practice_progress,
    get_mini_practice_progress,
    get_practice_progress,
    get_review_progress,
    get_segment_practice_progress,
    upsert_focus_practice_progress,
    upsert_mini_practice_progress,
    upsert_practice_progress,
    upsert_review_progress,
    upsert_segment_practice_progress,
)
from memory_anki.modules.sessions.application.study_session_bridge import (
    create_completed_study_session_from_time_payload,
)
from memory_anki.modules.sessions.application.study_session_service import (
    abandon_study_session,
    append_study_session_events,
    build_study_session_stats,
    bulk_delete_study_sessions,
    complete_study_session,
    count_study_sessions,
    create_study_session,
    delete_study_session,
    get_active_study_session_by_target,
    get_study_session,
    list_active_study_sessions,
    list_study_sessions,
    patch_study_session,
)
from memory_anki.modules.sessions.domain.schemas import (
    PracticeProgressUpsert,
    StudySessionAbandon,
    StudySessionBulkDelete,
    StudySessionComplete,
    StudySessionCreate,
    StudySessionEventsAppend,
    StudySessionPatch,
)

router = APIRouter(tags=["sessions"])
legacy_router = APIRouter(tags=["legacy-sessions"])


def _payload(data) -> dict:
    return data.model_dump(exclude_unset=True, exclude_none=False)


def _raise_not_found() -> None:
    raise HTTPException(status_code=404, detail="not found")


@router.post("/study-sessions")
def api_create_study_session(
    data: StudySessionCreate,
    request: Request,
    session: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response
    try:
        response = {"item": create_study_session(session, _payload(data))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    save_idempotent_response(session, request, response)
    return response


@router.get("/study-sessions/active")
def api_list_active_study_sessions(session: Session = Depends(session_dep)):
    return {"items": list_active_study_sessions(session)}


@router.get("/study-sessions/stats")
def api_study_session_stats(session: Session = Depends(session_dep)):
    return build_study_session_stats(session)


@router.get("/study-sessions/by-target")
def api_get_study_session_by_target(
    target_type: str,
    target_id: int | None = None,
    scene: str | None = None,
    session: Session = Depends(session_dep),
):
    return {
        "item": get_active_study_session_by_target(
            session,
            target_type=target_type,
            target_id=target_id,
            scene=scene,
        )
    }


@router.get("/study-sessions")
def api_list_study_sessions(
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(session_dep),
):
    if limit is None:
        return {"items": list_study_sessions(session)}
    return {
        "items": list_study_sessions(session, limit=limit, offset=offset),
        "total": count_study_sessions(session),
        "limit": limit,
        "offset": offset,
    }


@router.get("/study-sessions/{study_session_id}")
def api_get_study_session(study_session_id: str, session: Session = Depends(session_dep)):
    item = get_study_session(session, study_session_id)
    if item is None:
        _raise_not_found()
    return {"item": item}


@router.patch("/study-sessions/{study_session_id}")
def api_patch_study_session(
    study_session_id: str,
    data: StudySessionPatch,
    session: Session = Depends(session_dep),
):
    try:
        item = patch_study_session(session, study_session_id, _payload(data))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        _raise_not_found()
    return {"item": item}


@router.post("/study-sessions/{study_session_id}/events")
def api_append_study_session_events(
    study_session_id: str,
    data: StudySessionEventsAppend,
    request: Request,
    session: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response
    events = data.events
    item = append_study_session_events(
        session,
        study_session_id,
        events if isinstance(events, list) else [],
    )
    if item is None:
        _raise_not_found()
    response = {"item": item}
    save_idempotent_response(session, request, response)
    return response


@router.post("/study-sessions/{study_session_id}/complete")
def api_complete_study_session(
    study_session_id: str,
    data: StudySessionComplete,
    request: Request,
    session: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response
    item = complete_study_session(session, study_session_id, _payload(data))
    if item is None:
        _raise_not_found()
    response = {"item": item}
    save_idempotent_response(session, request, response)
    return response


@router.post("/study-sessions/{study_session_id}/abandon")
def api_abandon_study_session(
    study_session_id: str,
    data: StudySessionAbandon,
    request: Request,
    session: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response
    item = abandon_study_session(session, study_session_id, _payload(data))
    if item is None:
        _raise_not_found()
    response = {"item": item}
    save_idempotent_response(session, request, response)
    return response


@router.delete("/study-sessions/{study_session_id}")
def api_delete_study_session(study_session_id: str, session: Session = Depends(session_dep)):
    deleted = delete_study_session(session, study_session_id)
    if not deleted:
        _raise_not_found()
    return {"ok": True}


@router.post("/study-sessions/bulk-delete")
def api_bulk_delete_study_sessions(
    data: StudySessionBulkDelete,
    session: Session = Depends(session_dep),
):
    deleted = bulk_delete_study_sessions(session, [str(item) for item in data.ids])
    return {"ok": True, "deleted": deleted}


@router.post("/study-sessions/from-time-record")
def api_create_study_session_from_time_record(
    data: dict,
    request: Request,
    session: Session = Depends(session_dep),
):
    # Keep this as a free-form dict: legacy timer recovery sends mixed camelCase
    # and snake_case keys that the service normalizes directly.
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response
    try:
        response = {"item": create_completed_study_session_from_time_payload(session, data)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    save_idempotent_response(session, request, response)
    return response


@legacy_router.get("/sessions/practice/{palace_id}/progress")
def api_get_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        _raise_not_found()
    return {"progress": get_practice_progress(session, palace_id)}


@legacy_router.get("/sessions/focus-practice/{palace_id}/progress")
def api_get_focus_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        _raise_not_found()
    return {"progress": get_focus_practice_progress(session, palace_id)}


@legacy_router.put("/sessions/practice/{palace_id}/progress")
def api_upsert_practice_progress(
    palace_id: int,
    data: PracticeProgressUpsert,
    session: Session = Depends(session_dep),
):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        _raise_not_found()
    return {"progress": upsert_practice_progress(session, palace_id, _payload(data))}


@legacy_router.put("/sessions/focus-practice/{palace_id}/progress")
def api_upsert_focus_practice_progress(
    palace_id: int,
    data: PracticeProgressUpsert,
    session: Session = Depends(session_dep),
):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        _raise_not_found()
    return {"progress": upsert_focus_practice_progress(session, palace_id, _payload(data))}


@legacy_router.delete("/sessions/practice/{palace_id}/progress")
def api_delete_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    clear_practice_progress(session, palace_id)
    return {"ok": True}


@legacy_router.delete("/sessions/focus-practice/{palace_id}/progress")
def api_delete_focus_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    clear_focus_practice_progress(session, palace_id)
    return {"ok": True}


@legacy_router.get("/sessions/segment-practice/{segment_id}/progress")
def api_get_segment_practice_progress(segment_id: int, session: Session = Depends(session_dep)):
    segment = session.query(PalaceSegment).filter_by(id=segment_id).first()
    if not segment:
        _raise_not_found()
    return {"progress": get_segment_practice_progress(session, segment_id)}


@legacy_router.put("/sessions/segment-practice/{segment_id}/progress")
def api_upsert_segment_practice_progress(
    segment_id: int,
    data: PracticeProgressUpsert,
    session: Session = Depends(session_dep),
):
    segment = session.query(PalaceSegment).filter_by(id=segment_id).first()
    if not segment:
        _raise_not_found()
    return {
        "progress": upsert_segment_practice_progress(
            session,
            segment_id,
            segment.palace_id,
            _payload(data),
        )
    }


@legacy_router.delete("/sessions/segment-practice/{segment_id}/progress")
def api_delete_segment_practice_progress(segment_id: int, session: Session = Depends(session_dep)):
    clear_segment_practice_progress(session, segment_id)
    return {"ok": True}


@legacy_router.get("/sessions/mini-practice/{mini_palace_id}/progress")
def api_get_mini_practice_progress(
    mini_palace_id: int,
    session: Session = Depends(session_dep),
):
    mini_palace = session.query(PalaceMiniPalace).filter_by(id=mini_palace_id).first()
    if not mini_palace:
        _raise_not_found()
    return {"progress": get_mini_practice_progress(session, mini_palace_id)}


@legacy_router.put("/sessions/mini-practice/{mini_palace_id}/progress")
def api_upsert_mini_practice_progress(
    mini_palace_id: int,
    data: PracticeProgressUpsert,
    session: Session = Depends(session_dep),
):
    mini_palace = session.query(PalaceMiniPalace).filter_by(id=mini_palace_id).first()
    if not mini_palace:
        _raise_not_found()
    return {
        "progress": upsert_mini_practice_progress(
            session,
            mini_palace_id,
            mini_palace.palace_id,
            _payload(data),
        )
    }


@legacy_router.delete("/sessions/mini-practice/{mini_palace_id}/progress")
def api_delete_mini_practice_progress(
    mini_palace_id: int,
    session: Session = Depends(session_dep),
):
    clear_mini_practice_progress(session, mini_palace_id)
    return {"ok": True}


@legacy_router.get("/sessions/review/{schedule_id}/progress")
def api_get_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        _raise_not_found()
    return {"progress": get_review_progress(session, schedule_id)}


@legacy_router.put("/sessions/review/{schedule_id}/progress")
def api_upsert_review_progress(
    schedule_id: int,
    data: PracticeProgressUpsert,
    session: Session = Depends(session_dep),
):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        _raise_not_found()
    return {
        "progress": upsert_review_progress(
            session,
            schedule_id,
            schedule.palace_id,
            _payload(data),
        )
    }


@legacy_router.delete("/sessions/review/{schedule_id}/progress")
def api_delete_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    clear_review_progress(session, schedule_id)
    return {"ok": True}
