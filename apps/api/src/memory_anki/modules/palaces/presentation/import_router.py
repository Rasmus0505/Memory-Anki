from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace, get_session
from memory_anki.modules.palaces.application.import_export_service import (
    export_json,
    export_markdown,
    import_json,
    import_markdown,
)
from memory_anki.modules.palaces.application.mindmap_import_service import (
    BatchImportPreviewResult,
    MindMapImportError,
    generate_batch_import_preview,
    generate_import_preview,
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
