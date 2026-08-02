from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.session.application.serialization import _parse_datetime
from memory_anki.modules.session.application.study_session_commands import (
    abandon_study_session_command,
    append_study_session_events_command,
    complete_study_session_command,
    create_study_session_command,
    create_study_session_from_time_record_command,
)
from memory_anki.modules.session.application.study_session_service import (
    build_study_session_stats,
    build_time_record_analytics,
    build_time_record_read_model,
    bulk_delete_study_sessions,
    count_study_sessions,
    delete_study_session,
    get_active_study_session_by_target,
    get_study_session,
    list_active_study_sessions,
    list_study_sessions,
    patch_study_session,
    summarize_study_sessions_by_client_source,
)
from memory_anki.modules.session.application.time_record_read_model import (
    TimeRecordQueryError,
)
from memory_anki.modules.session.domain.schemas import (
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


@router.get("/study-sessions/time-records")
def api_time_records(
    range_mode: Literal["month", "rolling", "custom", "all"] = "month",
    month: str | None = Query(default=None, max_length=7),
    rolling_days: Literal[7, 30, 90] | None = None,
    start_date: str | None = Query(default=None, max_length=10),
    end_date: str | None = Query(default=None, max_length=10),
    keyword: str | None = Query(default=None, max_length=300),
    kind: Literal[
        "review",
        "practice",
        "quiz",
        "palace_edit",
        "english",
        "english_reading",
        "custom",
    ]
    | None = None,
    sort_by: Literal["started_at", "effective_seconds", "title"] = "started_at",
    sort_order: Literal["asc", "desc"] = "desc",
    limit: int = Query(default=20, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(session_dep),
):
    try:
        return build_time_record_read_model(
            session,
            range_mode=range_mode,
            month=month,
            rolling_days=rolling_days,
            start_date=start_date,
            end_date=end_date,
            keyword=keyword,
            kind=kind,
            sort_by=sort_by,
            sort_order=sort_order,
            limit=limit,
            offset=offset,
        )
    except TimeRecordQueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    kind: Literal["palace_edit", "practice", "quiz", "review", "custom"] | None = None,
    started_from: str | None = Query(default=None, max_length=40),
    started_to: str | None = Query(default=None, max_length=40),
    sort_by: Literal["started_at", "effective_seconds", "title"] = "started_at",
    sort_order: Literal["asc", "desc"] = "desc",
    include_source_summary: bool = Query(default=False),
    session: Session = Depends(session_dep),
):
    parsed_from = _parse_datetime(started_from) if started_from else None
    parsed_to = _parse_datetime(started_to) if started_to else None
    if started_from and parsed_from is None:
        raise HTTPException(status_code=400, detail="started_from 时间格式无效。")
    if started_to and parsed_to is None:
        raise HTTPException(status_code=400, detail="started_to 时间格式无效。")
    if limit is None:
        payload: dict[str, object] = {
            "items": list_study_sessions(
                session,
                keyword=keyword,
                kind=kind,
                status=status,
                started_from=parsed_from,
                started_to=parsed_to,
                sort_by=sort_by,
                sort_order=sort_order,
            )
        }
    else:
        payload = {
            "items": list_study_sessions(
                session,
                keyword=keyword,
                kind=kind,
                status=status,
                started_from=parsed_from,
                started_to=parsed_to,
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
                started_from=parsed_from,
                started_to=parsed_to,
            ),
            "limit": limit,
            "offset": offset,
        }
    if include_source_summary:
        payload["source_summary"] = summarize_study_sessions_by_client_source(
            session,
            keyword=keyword,
            kind=kind,
            status=status,
            started_from=parsed_from,
            started_to=parsed_to,
        )
    return payload


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
