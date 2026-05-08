from datetime import datetime, time, timedelta
from fastapi import APIRouter, UploadFile, File, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from models import get_session, Palace, Attachment as AttachmentModel, Peg, ReviewSchedule
from schemas import PalaceCreate, PalaceUpdate
from editor_state import (
    get_palace_editor_state,
    save_palace_editor_state,
    sync_palace_editor_root,
)
from services.palace_service import (
    list_palaces, get_palace, create_palace, update_palace, delete_palace, restore_archived_palaces,
)
from services.review_service import trigger_review_for_palace
from services.schedule_service import get_config_value
from config import ATTACHMENTS_DIR
import os, uuid

router = APIRouter(tags=["palaces"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def peg_json(peg) -> dict:
    return {
        "id": peg.id, "name": peg.name, "content": peg.content,
        "sort_order": peg.sort_order, "parent_id": peg.parent_id,
        "children": [peg_json(c) for c in (peg.children or [])],
    }


def schedule_display_datetime(schedule: ReviewSchedule, palace: Palace, session: Session) -> datetime | None:
    if not schedule.scheduled_date:
        return None

    created_at = palace.created_at or palace.updated_at
    base_time = created_at.time().replace(second=0, microsecond=0) if created_at else time(0, 0)

    if schedule.review_type == "sleep":
        raw_sleep_time = get_config_value(session, "sleep_review_time") or "22:00"
        try:
            hour_str, minute_str = raw_sleep_time.split(":", 1)
            display_time = time(int(hour_str), int(minute_str))
        except (ValueError, TypeError):
            display_time = time(22, 0)
    elif schedule.review_type == "1h":
        display_time = (datetime.combine(schedule.scheduled_date, base_time) + timedelta(hours=1)).time().replace(second=0, microsecond=0)
    else:
        display_time = base_time

    return datetime.combine(schedule.scheduled_date, display_time)


def review_plan_item_json(schedule: ReviewSchedule) -> dict:
    return {
        "id": schedule.id,
        "scheduled_date": schedule.scheduled_date.isoformat() if schedule.scheduled_date else None,
        "completed": schedule.completed,
        "review_number": schedule.review_number,
        "algorithm_used": schedule.algorithm_used,
        "review_type": schedule.review_type,
        "interval_days": schedule.interval_days,
    }


def palace_json(p, session: Session | None = None) -> dict:
    next_schedule = None
    pending_schedules = [schedule for schedule in (p.review_schedules or []) if not schedule.completed]
    if pending_schedules:
        next_schedule = min(pending_schedules, key=lambda schedule: (schedule.scheduled_date, schedule.id))
    next_review_at = schedule_display_datetime(next_schedule, p, session) if next_schedule and session else None

    return {
        "id": p.id, "title": p.title, "description": p.description,
        "archived": p.archived, "mastered": p.mastered,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "next_scheduled_date": next_schedule.scheduled_date.isoformat() if next_schedule and next_schedule.scheduled_date else None,
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "pegs": [peg_json(peg) for peg in p.pegs],
        "attachments": [{"id": a.id, "filename": a.filename,
                         "original_name": a.original_name, "file_size": a.file_size}
                        for a in p.attachments],
        "chapters": [{"id": c.id, "name": c.name, "subject_id": c.subject_id,
                      "subject": {"id": c.subject.id, "name": c.subject.name} if c.subject else None}
                      for c in p.chapters],
    }


@router.get("/palaces")
def api_list(search: str = "", s: Session = Depends(session_dep)):
    return [palace_json(p, s) for p in list_palaces(s, search)]


@router.get("/palaces/{palace_id}")
def api_get(palace_id: int, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    return {"error": "not found"} if not p else palace_json(p, s)


@router.post("/palaces")
def api_create(data: PalaceCreate, s: Session = Depends(session_dep)):
    palace = create_palace(s, data)
    trigger_review_for_palace(s, palace.id)
    return palace_json(palace, s)


@router.put("/palaces/{palace_id}")
def api_update(palace_id: int, data: PalaceUpdate, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        return {"error": "not found"}
    updated = update_palace(s, p, data)
    if data.title is not None:
        sync_palace_editor_root(updated)
        s.commit()
        s.refresh(updated)
    return palace_json(updated, s)


@router.delete("/palaces/{palace_id}")
def api_delete(palace_id: int, s: Session = Depends(session_dep)):
    delete_palace(s, palace_id)
    return {"ok": True}


@router.put("/palaces/{palace_id}/archive")
def api_archive(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        return {"error": "not found"}
    p.archived = False
    s.commit()
    return {"ok": True, "archived": p.archived}


@router.get("/palaces/{palace_id}/review-plan")
def api_review_plan(palace_id: int, s: Session = Depends(session_dep)):
    restore_archived_palaces(s)
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    schedules = (
        s.query(ReviewSchedule)
        .filter_by(palace_id=palace_id)
        .order_by(ReviewSchedule.scheduled_date, ReviewSchedule.id)
        .all()
    )
    return {
        "palace_id": palace.id,
        "palace_title": palace.title,
        "plan": [review_plan_item_json(schedule) for schedule in schedules],
    }


@router.get("/palaces/{palace_id}/editor")
def api_get_editor(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    return {
        "palace": palace_json(palace, s),
        **get_palace_editor_state(palace),
    }


@router.put("/palaces/{palace_id}/editor")
def api_update_editor(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    state = save_palace_editor_state(s, palace, data)
    return {
        "palace": palace_json(palace, s),
        **state,
    }


@router.post("/palaces/{palace_id}/upload")
async def api_upload(palace_id: int, file: UploadFile = File(...),
                     s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        return {"error": "not found"}
    ext = os.path.splitext(file.filename or "file")[1]
    unique_name = f"{uuid.uuid4().hex}{ext}"
    (ATTACHMENTS_DIR / unique_name).write_bytes(await file.read())
    att = AttachmentModel(palace_id=palace_id, filename=unique_name,
                          original_name=file.filename or "file", file_size=0)
    s.add(att)
    s.commit()
    return {"id": att.id, "filename": unique_name, "original_name": att.original_name}


@router.get("/attachments/{att_id}")
def api_attachment(att_id: int, s: Session = Depends(session_dep)):
    att = s.query(AttachmentModel).filter_by(id=att_id).first()
    if not att:
        return {"error": "not found"}
    fp = ATTACHMENTS_DIR / att.filename
    return FileResponse(fp, filename=att.original_name) if fp.exists() else {"error": "file missing"}


@router.delete("/attachments/{att_id}")
def api_attachment_delete(att_id: int, s: Session = Depends(session_dep)):
    att = s.query(AttachmentModel).filter_by(id=att_id).first()
    if att:
        fp = ATTACHMENTS_DIR / att.filename
        if fp.exists():
            os.remove(fp)
        s.delete(att)
        s.commit()
    return {"ok": True}
