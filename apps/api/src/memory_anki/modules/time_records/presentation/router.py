import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import get_session
from memory_anki.modules.persistence.application.idempotency import (
    get_idempotent_response,
    save_idempotent_response,
)
from memory_anki.modules.time_records.application.time_records_service import (
    create_time_record,
    get_threshold_seconds,
    import_legacy_time_records,
    list_time_records,
    normalize_time_record_event_timezones,
    restore_time_record,
    set_threshold_seconds,
    soft_delete_time_record,
    update_time_record,
)

router = APIRouter(tags=["time-records"])


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


@router.get("/time-records")
def api_list_time_records(
    include_deleted: bool = False,
    include_below_threshold: bool = False,
    session: Session = Depends(session_dep),
):
    return {
        "items": list_time_records(
            session,
            include_deleted=include_deleted,
            include_below_threshold=include_below_threshold,
        )
    }


@router.post("/time-records")
async def api_create_time_record(request: Request, session: Session = Depends(session_dep)):
    existing_response = get_idempotent_response(session, request)
    if existing_response is not None:
        return existing_response
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("时间记录请求体必须是 JSON 对象。")
        response = {"item": create_time_record(session, data)}
        save_idempotent_response(session, request, response)
        return response
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="时间记录请求体不是合法 JSON。") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/time-records/{record_id}")
def api_update_time_record(record_id: str, data: dict, session: Session = Depends(session_dep)):
    try:
        return {"item": update_time_record(session, record_id, data)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/time-records/{record_id}/soft-delete")
def api_soft_delete_time_record(record_id: str, session: Session = Depends(session_dep)):
    return {"item": soft_delete_time_record(session, record_id)}


@router.post("/time-records/{record_id}/restore")
def api_restore_time_record(record_id: str, session: Session = Depends(session_dep)):
    return {"item": restore_time_record(session, record_id)}


@router.get("/settings/time-recording-threshold")
def api_get_time_recording_threshold(session: Session = Depends(session_dep)):
    return {"seconds": get_threshold_seconds(session)}


@router.put("/settings/time-recording-threshold")
def api_update_time_recording_threshold(data: dict, session: Session = Depends(session_dep)):
    return {"seconds": set_threshold_seconds(session, int(data.get("seconds", 0)))}


@router.post("/time-records/import-legacy")
def api_import_legacy_time_records(data: dict, session: Session = Depends(session_dep)):
    imported = import_legacy_time_records(session, data.get("records", []), bool(data.get("clearExisting", False)))
    return {"imported": imported}


@router.post("/time-records/normalize-timezones")
def api_normalize_time_record_timezones(session: Session = Depends(session_dep)):
    return {"updated": normalize_time_record_event_timezones(session)}
