import os
import uuid
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from memory_anki.core.config import ATTACHMENTS_DIR
from memory_anki.infrastructure.db.models import Attachment as AttachmentModel
from memory_anki.infrastructure.db.models import Palace, ReviewSchedule, get_session
from memory_anki.modules.backups.application.backup_service import (
    cleanup_duplicate_palace_versions,
    create_full_backup,
    get_palace_version_detail,
    list_backups,
    list_palace_versions,
    maybe_create_rolling_backup,
    recover_palaces_from_git_snapshot,
    restore_database_backup,
    restore_palace_from_backup,
    restore_palace_version,
)
from memory_anki.modules.mindmap.application.editor_state_service import (
    get_palace_editor_state,
    save_palace_editor_state,
    sync_palace_editor_root,
)
from memory_anki.modules.palaces.application.palace_service import (
    create_palace,
    delete_palace,
    get_palace,
    list_palaces,
    restore_archived_palaces,
    update_palace,
)
from memory_anki.modules.palaces.domain.schemas import PalaceCreate, PalaceUpdate
from memory_anki.modules.reviews.application.review_service import trigger_review_for_palace
from memory_anki.modules.reviews.application.schedule_service import get_config_value
from memory_anki.modules.sessions.application.session_progress_service import (
    clear_practice_progress,
    get_practice_progress,
    upsert_practice_progress,
)

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


def review_plan_item_json(
    schedule: ReviewSchedule,
    same_day_index: int,
    same_day_total: int,
) -> dict:
    return {
        "id": schedule.id,
        "scheduled_date": schedule.scheduled_date.isoformat() if schedule.scheduled_date else None,
        "completed": schedule.completed,
        "review_number": schedule.review_number,
        "sequence_label": f"第 {schedule.review_number + 1} 次复习",
        "same_day_index": same_day_index,
        "same_day_total": same_day_total,
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
    has_due_review = bool(next_schedule and next_schedule.scheduled_date and next_schedule.scheduled_date <= datetime.now().date())

    return {
        "id": p.id, "title": p.title, "description": p.description,
        "archived": p.archived, "mastered": p.mastered,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "next_scheduled_date": next_schedule.scheduled_date.isoformat() if next_schedule and next_schedule.scheduled_date else None,
        "next_review_at": next_review_at.isoformat(timespec="minutes") if next_review_at else None,
        "has_due_review": has_due_review,
        "current_review_schedule_id": next_schedule.id if has_due_review and next_schedule else None,
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
    maybe_create_rolling_backup("rolling-create-palace")
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
    maybe_create_rolling_backup("rolling-update-palace")
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
    same_day_totals: dict[str | None, int] = {}
    same_day_seen: dict[str | None, int] = {}
    for schedule in schedules:
        key = schedule.scheduled_date.isoformat() if schedule.scheduled_date else None
        same_day_totals[key] = same_day_totals.get(key, 0) + 1

    plan = []
    for schedule in schedules:
        key = schedule.scheduled_date.isoformat() if schedule.scheduled_date else None
        same_day_seen[key] = same_day_seen.get(key, 0) + 1
        plan.append(
            review_plan_item_json(
                schedule,
                same_day_index=same_day_seen[key],
                same_day_total=same_day_totals[key],
            )
        )
    return {
        "palace_id": palace.id,
        "palace_title": palace.title,
        "plan": plan,
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
    maybe_create_rolling_backup("rolling-editor-save")
    return {
        "palace": palace_json(palace, s),
        **state,
    }


@router.get("/practice/session/{palace_id}")
def api_get_practice_progress(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    return {"progress": get_practice_progress(s, palace_id)}


@router.put("/practice/session/{palace_id}")
def api_upsert_practice_progress(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    return {"progress": upsert_practice_progress(s, palace_id, data)}


@router.delete("/practice/session/{palace_id}")
def api_delete_practice_progress(palace_id: int, s: Session = Depends(session_dep)):
    clear_practice_progress(s, palace_id)
    return {"ok": True}


@router.get("/palaces/{palace_id}/versions")
def api_list_palace_versions(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    removed_duplicates = cleanup_duplicate_palace_versions(s, palace.id)
    if removed_duplicates:
        s.commit()
    return {
        "palace_id": palace.id,
        "palace_title": palace.title,
        "removed_duplicates": removed_duplicates,
        "versions": list_palace_versions(s, palace.id),
    }


@router.get("/palaces/{palace_id}/versions/{version_id}")
def api_get_palace_version_detail(palace_id: int, version_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    detail = get_palace_version_detail(s, palace.id, version_id)
    if not detail:
        return {"error": "version not found"}
    return detail


@router.post("/palaces/{palace_id}/restore-version")
def api_restore_palace_version(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    version_id = int(data.get("version_id", 0))
    if version_id <= 0:
        return {"error": "invalid version id"}
    restore_palace_version(s, palace, version_id)
    s.refresh(palace)
    return {
        "ok": True,
        "palace": palace_json(palace, s),
        "versions": list_palace_versions(s, palace.id),
    }


@router.get("/backups")
def api_list_backups():
    return {"items": list_backups()}


@router.post("/backups/create")
def api_create_backup(data: dict | None = None):
    reason = (data or {}).get("reason") or "manual"
    folder = create_full_backup(str(reason))
    return {"ok": True, "path": str(folder)}


@router.post("/backups/restore-database")
def api_restore_backup(data: dict, s: Session = Depends(session_dep)):
    backup_path = str(data.get("path") or "")
    if not backup_path:
        return {"error": "missing backup path"}
    rescue = restore_database_backup(backup_path)
    return {"ok": True, "rescue_path": str(rescue)}


@router.post("/backups/recover-palaces")
def api_recover_palaces(data: dict, s: Session = Depends(session_dep)):
    commit = str(data.get("commit") or "").strip()
    palace_ids = [int(value) for value in (data.get("palace_ids") or []) if value is not None]
    if not commit or not palace_ids:
        return {"error": "missing commit or palace_ids"}
    result = recover_palaces_from_git_snapshot(s, commit, palace_ids)
    return {"ok": True, **result}


@router.post("/backups/restore-palace-from-backup")
def api_restore_palace_from_backup(data: dict, s: Session = Depends(session_dep)):
    backup_path = str(data.get("path") or "").strip()
    palace_id = int(data.get("palace_id") or 0)
    if not backup_path or palace_id <= 0:
        return {"error": "missing path or palace_id"}
    result = restore_palace_from_backup(s, backup_db_path=backup_path, palace_id=palace_id)
    return {"ok": True, "restored": result}


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
    maybe_create_rolling_backup("rolling-attachment-upload")
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
        maybe_create_rolling_backup("rolling-attachment-delete")
    return {"ok": True}
