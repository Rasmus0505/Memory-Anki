from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    Palace,
    PalaceSegment,
    PalaceSegmentReviewSchedule,
    ReviewSchedule,
    get_session,
)
from memory_anki.modules.sessions.application.session_progress_service import (
    clear_focus_practice_progress,
    clear_practice_progress,
    clear_review_progress,
    clear_segment_practice_progress,
    clear_segment_review_progress,
    get_focus_practice_progress,
    get_practice_progress,
    get_review_progress,
    get_segment_practice_progress,
    get_segment_review_progress,
    upsert_focus_practice_progress,
    upsert_practice_progress,
    upsert_review_progress,
    upsert_segment_practice_progress,
    upsert_segment_review_progress,
)

router = APIRouter(tags=["sessions"])


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


@router.get("/sessions/practice/{palace_id}/progress")
def api_get_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return {"error": "not found"}
    return {"progress": get_practice_progress(session, palace_id)}


@router.get("/sessions/focus-practice/{palace_id}/progress")
def api_get_focus_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return {"error": "not found"}
    return {"progress": get_focus_practice_progress(session, palace_id)}


@router.put("/sessions/practice/{palace_id}/progress")
def api_upsert_practice_progress(
    palace_id: int,
    data: dict,
    session: Session = Depends(session_dep),
):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return {"error": "not found"}
    return {"progress": upsert_practice_progress(session, palace_id, data)}


@router.put("/sessions/focus-practice/{palace_id}/progress")
def api_upsert_focus_practice_progress(
    palace_id: int,
    data: dict,
    session: Session = Depends(session_dep),
):
    palace = session.query(Palace).filter_by(id=palace_id).first()
    if not palace:
        return {"error": "not found"}
    return {"progress": upsert_focus_practice_progress(session, palace_id, data)}


@router.delete("/sessions/practice/{palace_id}/progress")
def api_delete_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    clear_practice_progress(session, palace_id)
    return {"ok": True}


@router.delete("/sessions/focus-practice/{palace_id}/progress")
def api_delete_focus_practice_progress(palace_id: int, session: Session = Depends(session_dep)):
    clear_focus_practice_progress(session, palace_id)
    return {"ok": True}


@router.get("/sessions/segment-practice/{segment_id}/progress")
def api_get_segment_practice_progress(segment_id: int, session: Session = Depends(session_dep)):
    segment = session.query(PalaceSegment).filter_by(id=segment_id).first()
    if not segment:
        return {"error": "not found"}
    return {"progress": get_segment_practice_progress(session, segment_id)}


@router.put("/sessions/segment-practice/{segment_id}/progress")
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


@router.delete("/sessions/segment-practice/{segment_id}/progress")
def api_delete_segment_practice_progress(segment_id: int, session: Session = Depends(session_dep)):
    clear_segment_practice_progress(session, segment_id)
    return {"ok": True}


@router.get("/sessions/review/{schedule_id}/progress")
def api_get_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(ReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule:
        return {"error": "not found"}
    return {"progress": get_review_progress(session, schedule_id)}


@router.put("/sessions/review/{schedule_id}/progress")
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


@router.delete("/sessions/review/{schedule_id}/progress")
def api_delete_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    clear_review_progress(session, schedule_id)
    return {"ok": True}


@router.get("/sessions/segment-review/{schedule_id}/progress")
def api_get_segment_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule or not schedule.segment:
        return {"error": "not found"}
    return {"progress": get_segment_review_progress(session, schedule_id)}


@router.put("/sessions/segment-review/{schedule_id}/progress")
def api_upsert_segment_review_progress(
    schedule_id: int,
    data: dict,
    session: Session = Depends(session_dep),
):
    schedule = session.query(PalaceSegmentReviewSchedule).filter_by(id=schedule_id).first()
    if not schedule or not schedule.segment:
        return {"error": "not found"}
    return {
        "progress": upsert_segment_review_progress(
            session,
            schedule_id,
            schedule.palace_segment_id,
            schedule.segment.palace_id,
            data,
        )
    }


@router.delete("/sessions/segment-review/{schedule_id}/progress")
def api_delete_segment_review_progress(schedule_id: int, session: Session = Depends(session_dep)):
    clear_segment_review_progress(session, schedule_id)
    return {"ok": True}
