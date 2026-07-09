import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables import get_session
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.backups.application.backup_lifecycle import create_rescue_snapshot
from memory_anki.modules.backups.application.full_transfer_service import (
    FullTransferError,
    build_full_archive,
    import_full_archive,
    inspect_archive,
)
from memory_anki.modules.palaces.application.import_export_service import (
    export_json,
    export_markdown,
    import_json,
    import_markdown,
)
from memory_anki.modules.palaces.application.mindmap_import import (
    MindMapImportError,
)
from memory_anki.modules.palaces.application.mindmap_import_job_service import (
    complete_job_from_preview,
    create_batch_import_job,
    create_image_import_job,
    delete_job,
    get_job,
    list_jobs,
    request_pause_job,
    run_job_async,
    serialize_job,
    wait_for_job_completion,
)
from memory_anki.modules.palaces.presentation.errors import raise_bad_request
from memory_anki.modules.reviews.application.review_execution_service import (
    trigger_review_for_palace,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    normalize_ai_runtime_options,
)

router = APIRouter(tags=["import-export"])

COMPAT_IMAGE_ENTITY_KEY = "__compat_preview_image__"
COMPAT_BATCH_ENTITY_KEY = "__compat_preview_batch__"


def _wait_for_job_result(job_id: str) -> dict:
    completed_job = wait_for_job_completion(get_session, job_id=job_id)
    payload = serialize_job(completed_job)
    if payload["status"] != "completed":
        raise_bad_request((payload.get("error") or {}).get("message") or "识别失败，请稍后继续恢复。")
    result = dict(payload.get("result") or {})
    result["ok"] = True
    result["resolved_ai"] = payload.get("resolved_ai")
    return result


def _parse_form_ai_options(value: str | None):
    if not value:
        return normalize_ai_runtime_options(None)
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        payload = {}
    return normalize_ai_runtime_options(payload)


@router.get("/export/json")
def api_export_json(s: Session = Depends(session_dep)):
    return PlainTextResponse(export_json(s), media_type="application/json",
                             headers={"Content-Disposition": "attachment; filename=palaces.json"})


@router.get("/export/markdown")
def api_export_md(s: Session = Depends(session_dep)):
    return PlainTextResponse(export_markdown(s), media_type="text/markdown",
                             headers={"Content-Disposition": "attachment; filename=palaces.md"})


@router.get("/export/full")
def api_export_full(s: Session = Depends(session_dep)):
    zip_bytes, filename = build_full_archive(s)
    return Response(
        zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/import/full/preview")
async def api_import_full_preview(
    file: UploadFile = File(...),
    s: Session = Depends(session_dep),
):
    try:
        return {"ok": True, **inspect_archive(await file.read(), s)}
    except FullTransferError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import/full")
async def api_import_full(
    file: UploadFile = File(...),
    s: Session = Depends(session_dep),
):
    zip_bytes = await file.read()
    try:
        inspect_archive(zip_bytes, s)
        create_rescue_snapshot("before-full-import")
        result = import_full_archive(zip_bytes, s)
        return {"ok": True, **result}
    except FullTransferError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import")
async def api_import(file: UploadFile = File(...), format: str = "json",
                     s: Session = Depends(session_dep)):
    content = (await file.read()).decode("utf-8")
    try:
        count = import_json(s, content) if format == "json" else import_markdown(s, content)
        latest = s.query(Palace).order_by(Palace.id.desc()).limit(count).all()
        for p in latest:
            trigger_review_for_palace(s, p.id)
        return {"ok": True, "count": count}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import/jobs/image")
async def api_create_image_import_job(
    entity_key: str = Form(...),
    mode: str = Form("mindmap"),
    fallback_title: str = Form("未命名宫殿"),
    ai_options: str = Form(default=""),
    file: UploadFile = File(...),
    s: Session = Depends(session_dep),
):
    try:
        job = create_image_import_job(
            s,
            entity_key=entity_key,
            mode=mode,
            image_bytes=await file.read(),
            filename=file.filename,
            fallback_title=fallback_title,
            ai_options=_parse_form_ai_options(ai_options),
        )
    except MindMapImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_job(job)


@router.post("/import/jobs/batch")
async def api_create_batch_import_job(
    entity_key: str = Form(...),
    fallback_title: str = Form("未命名宫殿"),
    structure_image_index: int | None = Form(None),
    ai_options: str = Form(default=""),
    files: list[UploadFile] = File(...),
    s: Session = Depends(session_dep),
):
    image_items: list[tuple[bytes, str | None]] = []
    for file in files:
        image_items.append((await file.read(), file.filename))
    try:
        job = create_batch_import_job(
            s,
            entity_key=entity_key,
            image_items=image_items,
            fallback_title=fallback_title,
            structure_image_index=structure_image_index,
            ai_options=_parse_form_ai_options(ai_options),
        )
    except MindMapImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_job(job)


@router.post("/import/jobs/{job_id}/run")
def api_run_import_job(job_id: str, s: Session = Depends(session_dep)):
    job = get_job(s, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    run_job_async(job_id)
    return serialize_job(job)


@router.post("/import/jobs/{job_id}/pause")
def api_pause_import_job(job_id: str, s: Session = Depends(session_dep)):
    try:
        job = request_pause_job(s, job_id=job_id)
    except MindMapImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_job(job)


@router.post("/import/jobs/{job_id}/complete-from-preview")
def api_complete_import_job_from_preview(job_id: str, data: dict, s: Session = Depends(session_dep)):
    try:
        job = complete_job_from_preview(
            s,
            job_id=job_id,
            result=dict(data.get("result") or {}),
            usage=dict(data.get("usage") or {}),
        )
    except MindMapImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_job(job)


@router.get("/import/jobs/{job_id}")
def api_get_import_job(job_id: str, s: Session = Depends(session_dep)):
    job = get_job(s, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    s.refresh(job)
    return serialize_job(job)


@router.get("/import/jobs")
def api_list_import_jobs(entity_key: str, s: Session = Depends(session_dep)):
    return {"items": [serialize_job(job) for job in list_jobs(s, entity_key=entity_key)]}


@router.delete("/import/jobs/{job_id}")
def api_delete_import_job(job_id: str, s: Session = Depends(session_dep)):
    job = delete_job(s, job_id=job_id)
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    return {"ok": True, "job": serialize_job(job)}


@router.post("/import/preview-mindmap")
async def api_preview_mindmap_import(
    file: UploadFile = File(...),
    fallback_title: str = "未命名宫殿",
    ai_options: str = Form(default=""),
    s: Session = Depends(session_dep),
):
    image_bytes = await file.read()
    try:
        job = create_image_import_job(
            s,
            entity_key=COMPAT_IMAGE_ENTITY_KEY,
            mode="mindmap",
            image_bytes=image_bytes,
            filename=file.filename,
            fallback_title=fallback_title,
            ai_options=_parse_form_ai_options(ai_options),
        )
    except MindMapImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    run_job_async(job.id)
    return _wait_for_job_result(job.id)


@router.post("/import/preview-mindmap-batch")
async def api_preview_batch_mindmap_import(
    files: list[UploadFile] = File(...),
    fallback_title: str = "未命名宫殿",
    structure_image_index: int | None = None,
    ai_options: str = Form(default=""),
    s: Session = Depends(session_dep),
):
    image_items: list[tuple[bytes, str | None]] = []
    for file in files:
        image_items.append((await file.read(), file.filename))
    try:
        job = create_batch_import_job(
            s,
            entity_key=COMPAT_BATCH_ENTITY_KEY,
            image_items=image_items,
            fallback_title=fallback_title,
            structure_image_index=structure_image_index,
            ai_options=_parse_form_ai_options(ai_options),
        )
    except MindMapImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    run_job_async(job.id)
    return _wait_for_job_result(job.id)


@router.post("/import/preview-text")
async def api_preview_text_import(
    file: UploadFile = File(...),
    ai_options: str = Form(default=""),
    s: Session = Depends(session_dep),
):
    image_bytes = await file.read()
    try:
        job = create_image_import_job(
            s,
            entity_key=COMPAT_IMAGE_ENTITY_KEY,
            mode="text",
            image_bytes=image_bytes,
            filename=file.filename,
            fallback_title="未命名宫殿",
            ai_options=_parse_form_ai_options(ai_options),
        )
    except MindMapImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    run_job_async(job.id)
    return _wait_for_job_result(job.id)
