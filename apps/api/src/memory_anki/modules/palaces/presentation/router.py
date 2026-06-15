import os
import uuid
from collections import OrderedDict

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from memory_anki.core.config import ATTACHMENTS_DIR
from memory_anki.infrastructure.db.models import Attachment as AttachmentModel
from memory_anki.infrastructure.db.models import ReviewSchedule, get_session
from memory_anki.modules.backups.application.backup_service import (
    cleanup_duplicate_palace_versions,
    create_full_backup,
    export_palace_snapshot_comparison,
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
    EditorStateConflictError,
    get_palace_editor_state,
    save_palace_editor_state,
    sync_palace_editor_root,
)
from memory_anki.modules.palaces.application.mindmap_ai_split_service import (
    MindMapAiSplitError,
    split_palace_editor_doc_with_ai,
)
from memory_anki.modules.palaces.application.mini_palace_service import (
    adjust_mini_palace_review_progress,
    build_mini_palace_editor_doc,
    create_palace_mini_palace,
    delete_palace_mini_palace,
    get_palace_mini_palace,
    list_palace_mini_palaces,
    mini_palace_summary_json,
    update_palace_mini_palace,
)
from memory_anki.modules.palaces.application.focus_service import (
    build_focus_editor_doc,
    parse_focus_node_uids,
    set_focus_node_uids,
    toggle_focus_node_uid,
)
from memory_anki.modules.palaces.application.palace_service import (
    create_palace,
    delete_palace,
    get_palace,
    list_palaces,
    list_palaces_by_subject,
    restore_archived_palaces,
    update_palace,
)
from memory_anki.modules.palaces.application.segment_review_service import (
    build_palace_default_segment_summary,
    build_segment_editor_doc,
    list_palace_segments,
    segment_summary_json,
)
from memory_anki.modules.palaces.application.segment_service import (
    adjust_palace_default_segment_review_progress,
    adjust_segment_review_progress,
    create_palace_segment,
    delete_palace_segment,
    get_palace_segment,
    update_palace_segment,
)
from memory_anki.modules.palaces.application.title_sync_service import (
    MINI_REVIEW_MODE_INDEPENDENT,
    MINI_REVIEW_MODE_MINI_ONLY,
    build_chapter_grouped_palace_list,
    build_grouped_palace_list,
    build_subject_shelf_summary,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    normalize_ai_runtime_options,
)
from memory_anki.modules.palaces.domain.schemas import PalaceCreate, PalaceUpdate
from memory_anki.modules.reviews.application.review_execution_service import (
    trigger_review_for_palace,
)
from memory_anki.modules.sessions.application.session_progress_service import (
    clear_practice_progress,
    get_practice_progress,
    upsert_practice_progress,
)

from memory_anki.modules.palaces.application.palace_serializer import (
    palace_json,
    review_plan_item_json,
)
router = APIRouter(tags=["palaces"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


@router.get("/palaces")
def api_list(search: str = "", s: Session = Depends(session_dep)):
    return [palace_json(p, s) for p in list_palaces(s, search)]


@router.get("/palaces/grouped")
def api_list_grouped(search: str = "", subject_id: int | None = None, s: Session = Depends(session_dep)):
    palaces = list_palaces_by_subject(s, subject_id, search)
    chapter_grouped = build_chapter_grouped_palace_list(s, palaces, lambda p, sess: palace_json(p, sess))
    model_grouped = build_grouped_palace_list(s, palaces, lambda p, sess: palace_json(p, sess))
    return {
        "groups": model_grouped.get("groups", []),
        "ungrouped": model_grouped.get("ungrouped", []),
        "subjects": chapter_grouped.get("subjects", []),
    }


@router.get("/palaces/subjects")
def api_list_subject_shelf(search: str = "", s: Session = Depends(session_dep)):
    palaces = list_palaces(s, search)
    for palace in palaces:
        palace_json(palace, s)
    return build_subject_shelf_summary(s, palaces)


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
    grouped_by_date: OrderedDict[str | None, list[ReviewSchedule]] = OrderedDict()
    for schedule in schedules:
        key = schedule.scheduled_date.isoformat() if schedule.scheduled_date else None
        grouped_by_date.setdefault(key, []).append(schedule)

    plan = [review_plan_item_json(date_key, grouped_schedules) for date_key, grouped_schedules in grouped_by_date.items()]
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
    try:
        state = save_palace_editor_state(s, palace, data)
    except EditorStateConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    maybe_create_rolling_backup("rolling-editor-save")
    return {
        "palace": palace_json(palace, s),
        **state,
    }


@router.get("/palaces/{palace_id}/focus-session")
def api_get_focus_session(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    focus_node_uids = parse_focus_node_uids(palace)
    return {
        "palace": palace_json(palace, s),
        "editor_doc": build_focus_editor_doc(palace),
        "focus_node_uids": focus_node_uids,
        "focus_count": len(focus_node_uids),
    }


@router.post("/palaces/{palace_id}/editor/ai-split")
def api_ai_split_editor_node(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    try:
        result = split_palace_editor_doc_with_ai(
            s,
            palace,
            data.get("editor_doc"),
            data.get("target_node_uid"),
            normalize_ai_runtime_options(data.get("ai_options")),
        )
    except MindMapAiSplitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "ok": True,
        "editor_doc": result.editor_doc,
        "generated_children_count": result.generated_children_count,
        "reassigned_existing_children_count": result.reassigned_existing_children_count,
        "model": result.model,
        "ai_call_log_id": getattr(result, "ai_call_log_id", None),
        "resolved_ai": getattr(result, "resolved_ai", None),
    }


@router.get("/palaces/{palace_id}/segments")
def api_list_segments(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    default_segment = build_palace_default_segment_summary(s, palace)
    return {"items": list_palace_segments(s, palace, default_segment_payload=default_segment)}


@router.post("/palaces/{palace_id}/segments")
def api_create_segment(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    segment = create_palace_segment(s, palace, data)
    maybe_create_rolling_backup("rolling-create-palace-segment")
    return {"item": segment_summary_json(s, segment)}


@router.put("/palace-segments/{segment_id}")
def api_update_segment(segment_id: int, data: dict, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment:
        return {"error": "not found"}
    updated = update_palace_segment(s, segment, data)
    maybe_create_rolling_backup("rolling-update-palace-segment")
    return {"item": segment_summary_json(s, updated)}


@router.put("/palace-segments/{segment_id}/review-progress")
def api_update_segment_review_progress(segment_id: int, data: dict, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment:
        return {"error": "not found"}
    updated = adjust_segment_review_progress(s, segment, data)
    maybe_create_rolling_backup("rolling-update-palace-segment-review-progress")
    return {"item": segment_summary_json(s, updated)}


@router.put("/palaces/{palace_id}/default-segment/review-progress")
def api_update_default_segment_review_progress(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    updated = adjust_palace_default_segment_review_progress(s, palace, data)
    maybe_create_rolling_backup("rolling-update-default-segment-review-progress")
    payload = palace_json(updated, s)
    default_segment = next(
        (item for item in payload.get("segments", []) if item.get("is_virtual_default")),
        None,
    )
    return {"item": default_segment, "palace": payload}


@router.put("/palaces/{palace_id}/practice-flag")
def api_update_palace_practice_flag(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    palace.needs_practice = bool(data.get("needs_practice", False))
    s.commit()
    s.refresh(palace)
    return {"item": palace_json(palace, s)}


@router.put("/palaces/{palace_id}/mini-review-mode")
def api_update_palace_mini_review_mode(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    next_mode = str(data.get("mini_review_mode") or MINI_REVIEW_MODE_INDEPENDENT).strip()
    if next_mode not in {MINI_REVIEW_MODE_INDEPENDENT, MINI_REVIEW_MODE_MINI_ONLY}:
        raise HTTPException(status_code=400, detail="invalid mini_review_mode")
    palace.mini_review_mode = next_mode
    s.commit()
    s.refresh(palace)
    maybe_create_rolling_backup("rolling-update-palace-mini-review-mode")
    return {"item": palace_json(palace, s)}


@router.put("/palaces/{palace_id}/focus-nodes/{node_uid}")
def api_toggle_palace_focus_node(
    palace_id: int,
    node_uid: str,
    data: dict | None = None,
    s: Session = Depends(session_dep),
):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    normalized_uid = str(node_uid or "").strip()
    if data is not None and "focused" in data:
        current_uids = parse_focus_node_uids(palace)
        target_focused = bool(data.get("focused"))
        if not normalized_uid:
            focus_node_uids = current_uids
            focused = False
        elif target_focused:
            focus_node_uids = set_focus_node_uids(palace, [*current_uids, normalized_uid])
            focused = True
        else:
            focus_node_uids = set_focus_node_uids(
                palace,
                [uid for uid in current_uids if uid != normalized_uid],
            )
            focused = False
    else:
        focus_node_uids, focused = toggle_focus_node_uid(palace, node_uid)
    s.commit()
    s.refresh(palace)
    return {
        "ok": True,
        "palace_id": palace.id,
        "node_uid": node_uid,
        "focused": focused,
        "focus_node_uids": focus_node_uids,
        "focus_count": len(focus_node_uids),
        "item": palace_json(palace, s),
    }


@router.get("/palaces/{palace_id}/mini-palaces")
def api_list_mini_palaces(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    return {"items": list_palace_mini_palaces(s, palace)}


@router.post("/palaces/{palace_id}/mini-palaces")
def api_create_mini_palace(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        return {"error": "not found"}
    mini_palace = create_palace_mini_palace(s, palace, data)
    maybe_create_rolling_backup("rolling-create-mini-palace")
    return {"item": mini_palace_summary_json(mini_palace, s)}


@router.get("/palace-mini-palaces/{mini_palace_id}")
def api_get_mini_palace(mini_palace_id: int, s: Session = Depends(session_dep)):
    mini_palace = get_palace_mini_palace(s, mini_palace_id)
    if not mini_palace or not mini_palace.palace:
        return {"error": "not found"}
    return {
        "item": mini_palace_summary_json(mini_palace, s),
        "palace": palace_json(mini_palace.palace, s),
        "editor_doc": build_mini_palace_editor_doc(mini_palace.palace, mini_palace),
    }


@router.put("/palace-mini-palaces/{mini_palace_id}")
def api_update_mini_palace(mini_palace_id: int, data: dict, s: Session = Depends(session_dep)):
    mini_palace = get_palace_mini_palace(s, mini_palace_id)
    if not mini_palace:
        return {"error": "not found"}
    updated = update_palace_mini_palace(s, mini_palace, data)
    maybe_create_rolling_backup("rolling-update-mini-palace")
    return {"item": mini_palace_summary_json(updated, s)}


@router.put("/palace-mini-palaces/{mini_palace_id}/review-progress")
def api_update_mini_palace_review_progress(
    mini_palace_id: int,
    data: dict,
    s: Session = Depends(session_dep),
):
    mini_palace = get_palace_mini_palace(s, mini_palace_id)
    if not mini_palace:
        return {"error": "not found"}
    updated = adjust_mini_palace_review_progress(s, mini_palace, data)
    maybe_create_rolling_backup("rolling-update-mini-palace-review-progress")
    return {
        "item": mini_palace_summary_json(updated, s),
        "palace": palace_json(updated.palace, s) if updated.palace else None,
    }


@router.delete("/palace-mini-palaces/{mini_palace_id}")
def api_delete_mini_palace(mini_palace_id: int, s: Session = Depends(session_dep)):
    mini_palace = get_palace_mini_palace(s, mini_palace_id)
    if not mini_palace:
        return {"error": "not found"}
    delete_palace_mini_palace(s, mini_palace)
    maybe_create_rolling_backup("rolling-delete-mini-palace")
    return {"ok": True}


@router.delete("/palace-segments/{segment_id}")
def api_delete_segment(segment_id: int, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment:
        return {"error": "not found"}
    delete_palace_segment(s, segment)
    maybe_create_rolling_backup("rolling-delete-palace-segment")
    return {"ok": True}


@router.get("/palace-segments/{segment_id}")
def api_get_segment(segment_id: int, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment or not segment.palace:
        return {"error": "not found"}
    return {
        "item": segment_summary_json(s, segment),
        "palace": palace_json(segment.palace, s),
        "editor_doc": build_segment_editor_doc(segment.palace, segment),
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


@router.post("/backups/compare-palace-snapshots")
def api_compare_palace_snapshots(data: dict, s: Session = Depends(session_dep)):
    palace_id = int(data.get("palace_id") or 0)
    version_id_raw = data.get("version_id")
    backup_path = str(data.get("backup_db_path") or data.get("path") or "").strip() or None
    version_id = int(version_id_raw) if version_id_raw not in (None, "", 0, "0") else None
    if palace_id <= 0:
        return {"error": "missing palace_id"}
    try:
        result = export_palace_snapshot_comparison(
            s,
            palace_id=palace_id,
            version_id=version_id,
            backup_db_path=backup_path,
        )
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, **result}


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
