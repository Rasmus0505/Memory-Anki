from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceMiniPalace,
    PalaceSegment,
    ReviewSchedule,
    get_session,
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
from memory_anki.modules.sessions.application.study_session_service import (
    abandon_study_session,
    append_study_session_events,
    build_study_session_stats,
    bulk_delete_study_sessions,
    complete_study_session,
    create_completed_study_session_from_time_payload,
    create_study_session,
    delete_study_session,
    get_active_study_session_by_target,
    get_study_session,
    list_active_study_sessions,
    list_study_sessions,
    patch_study_session,
)

router = APIRouter(tags=["sessions"])
legacy_router = APIRouter(tags=["legacy-sessions"])


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


def _raise_not_found() -> None:
    raise HTTPException(status_code=404, detail="not found")


@router.post("/study-sessions")
def api_create_study_session(data: dict, session: Session = Depends(session_dep)):
    try:
        return {"item": create_study_session(session, data)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    session: Session = Depends(session_dep),
):
    return {"items": list_study_sessions(session)}


@router.get("/study-sessions/{study_session_id}")
def api_get_study_session(study_session_id: str, session: Session = Depends(session_dep)):
    item = get_study_session(session, study_session_id)
    if item is None:
        _raise_not_found()
    return {"item": item}


@router.patch("/study-sessions/{study_session_id}")
def api_patch_study_session(
    study_session_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    try:
        item = patch_study_session(session, study_session_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if item is None:
        _raise_not_found()
    return {"item": item}


@router.post("/study-sessions/{study_session_id}/events")
def api_append_study_session_events(
    study_session_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    events = data.get("events") if isinstance(data, dict) else None
    item = append_study_session_events(
        session,
        study_session_id,
        events if isinstance(events, list) else [],
    )
    if item is None:
        _raise_not_found()
    return {"item": item}


@router.post("/study-sessions/{study_session_id}/complete")
def api_complete_study_session(
    study_session_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    item = complete_study_session(session, study_session_id, data)
    if item is None:
        _raise_not_found()
    return {"item": item}


@router.post("/study-sessions/{study_session_id}/abandon")
def api_abandon_study_session(
    study_session_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    item = abandon_study_session(session, study_session_id, data)
    if item is None:
        _raise_not_found()
    return {"item": item}


@router.delete("/study-sessions/{study_session_id}")
def api_delete_study_session(study_session_id: str, session: Session = Depends(session_dep)):
    deleted = delete_study_session(session, study_session_id)
    if not deleted:
        _raise_not_found()
    return {"ok": True}


@router.post("/study-sessions/bulk-delete")
def api_bulk_delete_study_sessions(data: dict, session: Session = Depends(session_dep)):
    raw_ids = data.get("ids") if isinstance(data, dict) else None
    if not isinstance(raw_ids, list):
        raise HTTPException(status_code=400, detail="ids must be a list")
    deleted = bulk_delete_study_sessions(session, [str(item) for item in raw_ids])
    return {"ok": True, "deleted": deleted}


@router.post("/study-sessions/from-time-record")
def api_create_study_session_from_time_record(data: dict, session: Session = Depends(session_dep)):
    try:
        return {"item": create_completed_study_session_from_time_payload(session, data)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@legacy_router.get("/sessions/practice/{palace_id}/progress")
def api_get_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return {"error": "not found"}
    return {"progress": get_practice_progress(session, palace_id)}


@legacy_router.get("/sessions/focus-practice/{palace_id}/progress")
def api_get_focus_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return {"error": "not found"}
    return {"progress": get_focus_practice_progress(session, palace_id)}


@legacy_router.put("/sessions/practice/{palace_id}/progress")
def api_upsert_practice_progress(
    palace_id: int,
    data: dict,
    session: Session = Depends(session_dep),
):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return {"error": "not found"}
    return {"progress": upsert_practice_progress(session, palace_id, data)}


@legacy_router.put("/sessions/focus-practice/{palace_id}/progress")
def api_upsert_focus_practice_progress(
    palace_id: int,
    data: dict,
    session: Session = Depends(session_dep),
):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return {"error": "not found"}
    return {"progress": upsert_focus_practice_progress(session, palace_id, data)}


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
        return {"error": "not found"}
    return {"progress": get_segment_practice_progress(session, segment_id)}


@legacy_router.put("/sessions/segment-practice/{segment_id}/progress")
def api_upsert_segment_practice_progress(
    segment_id: int,
    data: dict,
    session: Session = Depends(session_dep),
):
    segment = session.query(PalaceSegment).filter_by(id=segment_id).first()
    if not segment:
        return {"error": "not found"}
    return {
        "progress": upsert_segment_practice_progress(
            session,
            segment_id,
            segment.palace_id,
            data,
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
        return {"error": "not found"}
    return {"progress": get_mini_practice_progress(session, mini_palace_id)}


@legacy_router.put("/sessions/mini-practice/{mini_palace_id}/progress")
def api_upsert_mini_practice_progress(
    mini_palace_id: int,
    data: dict,
    session: Session = Depends(session_dep),
):
    mini_palace = session.query(PalaceMiniPalace).filter_by(id=mini_palace_id).first()
    if not mini_palace:
        return {"error": "not found"}
    return {
        "progress": upsert_mini_practice_progress(
            session,
            mini_palace_id,
            mini_palace.palace_id,
            data,
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
        return {"error": "not found"}
    return {"progress": get_review_progress(session, schedule_id)}


@legacy_router.put("/sessions/review/{schedule_id}/progress")
def api_upsert_review_progress(
    schedule_id: int,
    data: dict,
    session: Session = Depends(session_dep),
):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return {"error": "not found"}
    return {
        "progress": upsert_review_progress(
            session,
            schedule_id,
            schedule.palace_id,
            data,
        )
    }


@legacy_router.delete("/sessions/review/{schedule_id}/progress")
def api_delete_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    clear_review_progress(session, schedule_id)
    return {"ok": True}


