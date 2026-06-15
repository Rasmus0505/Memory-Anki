import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, get_session
from memory_anki.modules.knowledge.application.subject_document_service import (
    get_subject_document_by_id,
)
from memory_anki.modules.palaces.application.import_export_service import (
    export_json,
    export_markdown,
    import_json,
    import_markdown,
)
from memory_anki.modules.palaces.application.mindmap_import_job_service import (
    complete_job_from_preview,
    create_batch_import_job,
    create_image_import_job,
    create_pdf_import_job,
    delete_job,
    get_job,
    list_jobs,
    request_pause_job,
    run_job_async,
    serialize_job,
    wait_for_job_completion,
)
from memory_anki.modules.palaces.application.mindmap_import_service import (
    PDF_IMPORT_MODE_DIRECT_GENERATION,
    MindMapImportError,
    PdfImportOptions,
    stream_pdf_import_preview,
)
from memory_anki.modules.reviews.application.review_execution_service import (
    trigger_review_for_palace,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    normalize_ai_runtime_options,
)

router = APIRouter(tags=["import-export"])

COMPAT_IMAGE_ENTITY_KEY = "__compat_preview_image__"
COMPAT_BATCH_ENTITY_KEY = "__compat_preview_batch__"
COMPAT_PDF_ENTITY_KEY = "__compat_preview_pdf__"


def _wait_for_job_result(job_id: str) -> dict:
    completed_job = wait_for_job_completion(get_session, job_id=job_id)
    payload = serialize_job(completed_job)
    if payload["status"] != "completed":
        return {
            "ok": False,
            "error": (payload.get("error") or {}).get("message") or "识别失败，请稍后继续恢复。",
        }
    result = dict(payload.get("result") or {})
    result["ok"] = True
    result["resolved_ai"] = payload.get("resolved_ai")
    return result


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def _stream_import_events(events):
    for event in events:
        yield f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"


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
    except Exception as e:
        return {"ok": False, "error": str(e)}


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


@router.post("/import/jobs/pdf")
def api_create_pdf_import_job(data: dict, s: Session = Depends(session_dep)):
    entity_key = str(data.get("entity_key") or "")
    mode = str(data.get("mode") or "mindmap")
    document_id = int(data.get("subject_document_id") or 0)
    page_selection = data.get("page_selection") or []
    structure_page = data.get("structure_page")
    pdf_mode = str(data.get("pdf_mode") or PDF_IMPORT_MODE_DIRECT_GENERATION)
    range_prompt = str(data.get("range_prompt") or "")
    fallback_title = str(data.get("fallback_title") or "未命名宫殿")
    import_options_data = data.get("import_options") or {}
    document = get_subject_document_by_id(s, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="未找到所选 PDF 资料。")
    import_options = PdfImportOptions(
        quote_original_text_only=bool(import_options_data.get("quote_original_text_only", True)),
        mount_on_original_leaf_only=bool(import_options_data.get("mount_on_original_leaf_only", True)),
        preserve_emphasis_marks=bool(import_options_data.get("preserve_emphasis_marks", True)),
        semantic_split_long_paragraphs=bool(import_options_data.get("semantic_split_long_paragraphs", True)),
        preserve_line_breaks=bool(import_options_data.get("preserve_line_breaks", True)),
    )
    try:
        job = create_pdf_import_job(
            s,
            entity_key=entity_key,
            document=document,
            mode=mode,
            page_selection=[int(page) for page in page_selection],
            structure_page=int(structure_page) if structure_page is not None else None,
            pdf_mode=pdf_mode,
            range_prompt=range_prompt,
            fallback_title=fallback_title,
            import_options=import_options,
            ai_options=normalize_ai_runtime_options(data.get("ai_options")),
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
        return {"ok": False, "error": str(exc)}
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
        return {"ok": False, "error": str(exc)}
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
        return {"ok": False, "error": str(exc)}
    run_job_async(job.id)
    return _wait_for_job_result(job.id)


@router.post("/import/preview-mindmap-pdf")
def api_preview_pdf_mindmap_import(data: dict, s: Session = Depends(session_dep)):
    document_id = int(data.get("subject_document_id") or 0)
    page_selection = data.get("page_selection") or []
    structure_page = data.get("structure_page")
    pdf_mode = str(data.get("pdf_mode") or PDF_IMPORT_MODE_DIRECT_GENERATION)
    range_prompt = str(data.get("range_prompt") or "")
    fallback_title = str(data.get("fallback_title") or "未命名宫殿")
    import_options_data = data.get("import_options") or {}
    document = get_subject_document_by_id(s, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="未找到所选 PDF 资料。")
    import_options = PdfImportOptions(
        quote_original_text_only=bool(import_options_data.get("quote_original_text_only", True)),
        mount_on_original_leaf_only=bool(import_options_data.get("mount_on_original_leaf_only", True)),
        preserve_emphasis_marks=bool(import_options_data.get("preserve_emphasis_marks", True)),
        semantic_split_long_paragraphs=bool(import_options_data.get("semantic_split_long_paragraphs", True)),
        preserve_line_breaks=bool(import_options_data.get("preserve_line_breaks", True)),
    )
    return StreamingResponse(
        _stream_import_events(
            stream_pdf_import_preview(
                document=document,
                page_selection=[int(page) for page in page_selection],
                structure_page=int(structure_page) if structure_page is not None else None,
                pdf_mode=pdf_mode,
                range_prompt=range_prompt,
                fallback_title=fallback_title,
                import_options=import_options,
                session=s,
                ai_options=normalize_ai_runtime_options(data.get("ai_options")),
            )
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/import/preview-text-pdf")
def api_preview_pdf_text_import(data: dict, s: Session = Depends(session_dep)):
    document_id = int(data.get("subject_document_id") or 0)
    page_selection = data.get("page_selection") or []
    range_prompt = str(data.get("range_prompt") or "")
    document = get_subject_document_by_id(s, document_id)
    if not document:
        return {"ok": False, "error": "未找到所选 PDF 资料。"}
    try:
        job = create_pdf_import_job(
            s,
            entity_key=COMPAT_PDF_ENTITY_KEY,
            document=document,
            mode="text",
            page_selection=[int(page) for page in page_selection],
            structure_page=None,
            pdf_mode=PDF_IMPORT_MODE_DIRECT_GENERATION,
            range_prompt=range_prompt,
            fallback_title=document.original_name or "未命名宫殿",
            import_options=None,
            ai_options=normalize_ai_runtime_options(data.get("ai_options")),
        )
    except MindMapImportError as exc:
        return {"ok": False, "error": str(exc)}
    run_job_async(job.id)
    return _wait_for_job_result(job.id)
