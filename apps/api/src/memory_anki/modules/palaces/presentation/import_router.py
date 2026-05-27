from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import PlainTextResponse
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
from memory_anki.modules.palaces.application.mindmap_import_service import (
    BatchImportPreviewResult,
    MindMapImportError,
    PdfImportOptions,
    generate_batch_import_preview,
    generate_import_preview,
    generate_pdf_import_preview,
    generate_pdf_text_preview,
    generate_text_preview,
)
from memory_anki.modules.reviews.application.review_service import trigger_review_for_palace

router = APIRouter(tags=["import-export"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


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


@router.post("/import/preview-mindmap")
async def api_preview_mindmap_import(
    file: UploadFile = File(...),
    fallback_title: str = "未命名宫殿",
):
    try:
        image_bytes = await file.read()
        result = generate_import_preview(
            image_bytes=image_bytes,
            filename=file.filename,
            fallback_title=fallback_title,
        )
        return {
            "ok": True,
            "source_tree": result.source_tree,
            "editor_doc": result.editor_doc,
        }
    except MindMapImportError as exc:
        return {"ok": False, "error": str(exc)}


@router.post("/import/preview-mindmap-batch")
async def api_preview_batch_mindmap_import(
    files: list[UploadFile] = File(...),
    fallback_title: str = "未命名宫殿",
    structure_image_index: int | None = None,
):
    try:
        image_items: list[tuple[bytes, str | None]] = []
        for file in files:
            image_items.append((await file.read(), file.filename))
        result: BatchImportPreviewResult = generate_batch_import_preview(
            image_items=image_items,
            fallback_title=fallback_title,
            structure_image_index=structure_image_index,
        )
        return {
            "ok": True,
            "source_tree": result.source_tree,
            "editor_doc": result.editor_doc,
            "structure_image_index": result.structure_image_index,
            "image_count": result.image_count,
        }
    except MindMapImportError as exc:
        return {"ok": False, "error": str(exc)}


@router.post("/import/preview-text")
async def api_preview_text_import(
    file: UploadFile = File(...),
):
    try:
        image_bytes = await file.read()
        result = generate_text_preview(
            image_bytes=image_bytes,
            filename=file.filename,
        )
        return {
            "ok": True,
            "extracted_text": result.extracted_text,
        }
    except MindMapImportError as exc:
        return {"ok": False, "error": str(exc)}


@router.post("/import/preview-mindmap-pdf")
def api_preview_pdf_mindmap_import(data: dict, s: Session = Depends(session_dep)):
    document_id = int(data.get("subject_document_id") or 0)
    page_selection = data.get("page_selection") or []
    structure_page = data.get("structure_page")
    range_prompt = str(data.get("range_prompt") or "")
    fallback_title = str(data.get("fallback_title") or "未命名宫殿")
    import_options_data = data.get("import_options") or {}
    document = get_subject_document_by_id(s, document_id)
    if not document:
        return {"ok": False, "error": "未找到所选 PDF 资料。"}
    try:
        import_options = PdfImportOptions(
            strict_restore=bool(import_options_data.get("strict_restore", True)),
            quote_original_text_only=bool(import_options_data.get("quote_original_text_only", True)),
            mount_on_original_leaf_only=bool(import_options_data.get("mount_on_original_leaf_only", True)),
            preserve_emphasis_marks=bool(import_options_data.get("preserve_emphasis_marks", True)),
            semantic_split_long_paragraphs=bool(import_options_data.get("semantic_split_long_paragraphs", True)),
            preserve_line_breaks=bool(import_options_data.get("preserve_line_breaks", True)),
        )
        result = generate_pdf_import_preview(
            document=document,
            page_selection=[int(page) for page in page_selection],
            structure_page=int(structure_page) if structure_page is not None else None,
            range_prompt=range_prompt,
            fallback_title=fallback_title,
            import_options=import_options,
        )
        return {
            "ok": True,
            "source_tree": result.source_tree,
            "editor_doc": result.editor_doc,
            "selected_pages": result.selected_pages,
            "structure_page": result.structure_page,
            "match_mode": result.match_mode,
            "can_apply": result.can_apply,
            "warnings": result.warnings or [],
        }
    except MindMapImportError as exc:
        return {"ok": False, "error": str(exc)}


@router.post("/import/preview-text-pdf")
def api_preview_pdf_text_import(data: dict, s: Session = Depends(session_dep)):
    document_id = int(data.get("subject_document_id") or 0)
    page_selection = data.get("page_selection") or []
    range_prompt = str(data.get("range_prompt") or "")
    document = get_subject_document_by_id(s, document_id)
    if not document:
        return {"ok": False, "error": "未找到所选 PDF 资料。"}
    try:
        result = generate_pdf_text_preview(
            document=document,
            page_selection=[int(page) for page in page_selection],
            range_prompt=range_prompt,
        )
        return {
            "ok": True,
            "extracted_text": result.extracted_text,
            "selected_pages": result.selected_pages,
        }
    except MindMapImportError as exc:
        return {"ok": False, "error": str(exc)}
