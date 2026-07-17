from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceSegment,
)
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.sessions.application.session_progress_service import (
    clear_practice_progress,
    clear_segment_practice_progress,
    get_practice_progress,
    get_segment_practice_progress,
    upsert_practice_progress,
    upsert_segment_practice_progress,
)
from memory_anki.modules.sessions.application.study_session_commands import (
    abandon_study_session_command,
    append_study_session_events_command,
    complete_study_session_command,
    create_study_session_command,
    create_study_session_from_time_record_command,
)
from memory_anki.modules.sessions.application.study_session_service import (
    build_study_session_stats,
    build_time_record_analytics,
    bulk_delete_study_sessions,
    count_study_sessions,
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
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter(tags=["sessions"])
legacy_router = APIRouter(tags=["legacy-sessions"])


def _payload(data) -> dict:
    return data.model_dump(exclude_unset=True, exclude_none=False)


def _raise_not_found() -> NoReturn:
    raise HTTPException(status_code=404, detail="not found")


@router.post("/study-sessions")
def api_create_study_session(
    data: StudySessionCreate,
    request: Request,
    session: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        return create_study_session_command(
            session,
            _payload(data),
            uow=SqlAlchemyUnitOfWork(session),
            before_commit=lambda response: mutation_store.save(
                mutation_identity, response
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/study-sessions/active")
def api_list_active_study_sessions(session: Session = Depends(session_dep)):
    return {"items": list_active_study_sessions(session)}


@router.get("/study-sessions/stats")
def api_study_session_stats(session: Session = Depends(session_dep)):
    return build_study_session_stats(session)


@router.get('/study-sessions/time-record-analytics')
def api_time_record_analytics(
    trend_range: Literal['7', '30', '90', 'all'] = '7',
    breakdown_range: Literal['7', '30', '90', 'all'] = 'all',
    session: Session = Depends(session_dep),
):
    return build_time_record_analytics(
        session,
        trend_range='all' if trend_range == 'all' else int(trend_range),
        breakdown_range='all' if breakdown_range == 'all' else int(breakdown_range),
    )


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
    status: Literal["active", "paused", "completed", "abandoned", "recovered"] | None = None,
    offset: int = Query(default=0, ge=0),
    keyword: str | None = Query(default=None, max_length=300),
    kind: Literal["palace_edit", "practice", "quiz", "review"] | None = None,
    sort_by: Literal["started_at", "effective_seconds", "title"] = "started_at",
    sort_order: Literal["asc", "desc"] = "desc",
    session: Session = Depends(session_dep),
):
    if limit is None:
        return {
            "items": list_study_sessions(
                session,
                keyword=keyword,
                kind=kind,
                status=status,
                sort_by=sort_by,
                sort_order=sort_order,
            )
        }
    return {
        "items": list_study_sessions(
            session,
            keyword=keyword,
            kind=kind,
            status=status,
            sort_by=sort_by,
            sort_order=sort_order,
            limit=limit,
            offset=offset,
        ),
        "total": count_study_sessions(
            session,
            keyword=keyword,
            kind=kind,
            status=status,
        ),
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
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    events = data.events
    response = append_study_session_events_command(
        session,
        study_session_id,
        events if isinstance(events, list) else [],
        uow=SqlAlchemyUnitOfWork(session),
        before_commit=lambda payload: mutation_store.save(mutation_identity, payload),
    )
    if response is None:
        _raise_not_found()
    return response


@router.post("/study-sessions/{study_session_id}/complete")
def api_complete_study_session(
    study_session_id: str,
    data: StudySessionComplete,
    request: Request,
    session: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    response = complete_study_session_command(
        session,
        study_session_id,
        _payload(data),
        uow=SqlAlchemyUnitOfWork(session),
        before_commit=lambda payload: mutation_store.save(mutation_identity, payload),
    )
    if response is None:
        _raise_not_found()
    return response


@router.post("/study-sessions/{study_session_id}/abandon")
def api_abandon_study_session(
    study_session_id: str,
    data: StudySessionAbandon,
    request: Request,
    session: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    response = abandon_study_session_command(
        session,
        study_session_id,
        _payload(data),
        uow=SqlAlchemyUnitOfWork(session),
        before_commit=lambda payload: mutation_store.save(mutation_identity, payload),
    )
    if response is None:
        _raise_not_found()
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
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(session)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    try:
        return create_study_session_from_time_record_command(
            session,
            data,
            uow=SqlAlchemyUnitOfWork(session),
            before_commit=lambda response: mutation_store.save(
                mutation_identity, response
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@legacy_router.get("/sessions/practice/{palace_id}/progress")
def api_get_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        _raise_not_found()
    return {"progress": get_practice_progress(session, palace_id)}


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


@legacy_router.delete("/sessions/practice/{palace_id}/progress")
def api_delete_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    clear_practice_progress(session, palace_id)
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


@legacy_router.get("/sessions/review/{schedule_id}/progress")
def api_get_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    del schedule_id, session
    # Legacy ReviewSchedule progress retired; formal review uses /review/session/{id}/progress.
    _raise_not_found()


@legacy_router.put("/sessions/review/{schedule_id}/progress")
def api_upsert_review_progress(
    schedule_id: int,
    data: PracticeProgressUpsert,
    session: Session = Depends(session_dep),
):
    del schedule_id, data, session
    _raise_not_found()


@legacy_router.delete("/sessions/review/{schedule_id}/progress")
def api_delete_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    del schedule_id, session
    _raise_not_found()
