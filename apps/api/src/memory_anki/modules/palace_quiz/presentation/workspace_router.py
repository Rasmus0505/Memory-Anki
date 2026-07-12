from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from memory_anki.core.runtime_paths import get_app_home
from memory_anki.infrastructure.db._tables.quiz_generation import QuizPdfAsset
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palace_quiz.application import workspace_service as service
from memory_anki.modules.palace_quiz.application.ai_dependencies import PalaceQuizAiDependencies
from memory_anki.modules.palace_quiz.application.question_contracts import (
    PalaceQuizNotFoundError,
    PalaceQuizValidationError,
)
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog

router = APIRouter(tags=["palace_quiz_workspace"])


def _ai_dependencies(session: Session) -> PalaceQuizAiDependencies:
    return PalaceQuizAiDependencies(
        runtime=SettingsAiRuntimeProvider(session),
        prompts=SettingsPromptCatalog(session),
    )


def _handle(exc: Exception) -> None:
    if isinstance(exc, PalaceQuizNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, PalaceQuizValidationError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


@router.get("/quiz-pdf-assets")
def api_list_pdf_assets(include_archived: bool = False, s: Session = Depends(session_dep)):
    return {"items": service.list_pdf_assets(s, include_archived=include_archived)}


@router.post("/quiz-pdf-assets")
async def api_upload_pdf_asset(
    file: UploadFile = File(...), name: str = Form(default=""), s: Session = Depends(session_dep)
):
    try:
        return {
            "item": service.upload_pdf_asset(
                s,
                content=await file.read(),
                original_name=file.filename or "document.pdf",
                name=name,
            )
        }
    except Exception as exc:
        _handle(exc)


@router.patch("/quiz-pdf-assets/{asset_id}")
def api_update_pdf_asset(asset_id: int, data: dict, s: Session = Depends(session_dep)):
    try:
        return {
            "item": service.update_pdf_asset(
                s, asset_id, name=data.get("name"), archived=data.get("archived")
            )
        }
    except Exception as exc:
        _handle(exc)


@router.delete("/quiz-pdf-assets/{asset_id}")
def api_delete_pdf_asset(asset_id: int, s: Session = Depends(session_dep)):
    try:
        service.delete_pdf_asset(s, asset_id)
        return {"ok": True}
    except Exception as exc:
        _handle(exc)


@router.get("/quiz-pdf-assets/{asset_id}/file")
def api_read_pdf_asset(asset_id: int, s: Session = Depends(session_dep)):
    asset = s.get(QuizPdfAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="PDF 资料不存在。")
    path = (get_app_home() / asset.relative_path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail="PDF 文件不存在。")
    return FileResponse(path, media_type="application/pdf", filename=asset.original_name)


@router.get("/palaces/{palace_id}/quiz-generation-jobs")
def api_list_jobs(palace_id: int, s: Session = Depends(session_dep)):
    return {"items": service.list_jobs(s, palace_id)}


@router.post("/palaces/{palace_id}/quiz-generation-jobs")
def api_create_job(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    try:
        return {"item": service.create_job(s, palace_id=palace_id, data=data)}
    except Exception as exc:
        _handle(exc)


@router.get("/quiz-generation-jobs/{job_id}")
def api_get_job(job_id: str, s: Session = Depends(session_dep)):
    try:
        return {"item": service.serialize_job(s, job_id)}
    except Exception as exc:
        _handle(exc)


@router.patch("/quiz-generation-jobs/{job_id}")
def api_update_job(job_id: str, data: dict, s: Session = Depends(session_dep)):
    try:
        return {"item": service.update_job(s, job_id, data)}
    except Exception as exc:
        _handle(exc)


@router.delete("/quiz-generation-jobs/{job_id}")
def api_delete_job(job_id: str, s: Session = Depends(session_dep)):
    try:
        service.delete_job(s, job_id)
        return {"ok": True}
    except Exception as exc:
        _handle(exc)


@router.post("/quiz-generation-jobs/{job_id}/sources/text")
def api_add_text_source(job_id: str, data: dict, s: Session = Depends(session_dep)):
    try:
        return {"item": service.add_text_source(s, job_id, data)}
    except Exception as exc:
        _handle(exc)


@router.post("/quiz-generation-jobs/{job_id}/sources/pdf")
def api_add_pdf_source(job_id: str, data: dict, s: Session = Depends(session_dep)):
    try:
        return {"item": service.add_pdf_source(s, job_id, data)}
    except Exception as exc:
        _handle(exc)


@router.post("/quiz-generation-jobs/{job_id}/sources/file")
async def api_add_file_source(
    job_id: str,
    role: str = Form(...),
    file: UploadFile = File(...),
    s: Session = Depends(session_dep),
):
    try:
        return {
            "item": service.add_file_source(
                s,
                job_id,
                role=role,
                content=await file.read(),
                original_name=file.filename or "source",
                mime_type=file.content_type or "application/octet-stream",
            )
        }
    except Exception as exc:
        _handle(exc)


@router.delete("/quiz-generation-jobs/{job_id}/sources/{source_id}")
def api_delete_source(job_id: str, source_id: int, s: Session = Depends(session_dep)):
    try:
        service.delete_source(s, job_id, source_id)
        return {"ok": True}
    except Exception as exc:
        _handle(exc)


@router.put("/quiz-generation-jobs/{job_id}/sources/order")
def api_reorder_sources(job_id: str, data: dict, s: Session = Depends(session_dep)):
    try:
        return {
            "item": service.reorder_sources(
                s, job_id, [int(value) for value in data.get("source_ids") or []]
            )
        }
    except Exception as exc:
        _handle(exc)


@router.post("/quiz-generation-jobs/{job_id}/extract-match")
def api_extract_match(job_id: str, data: dict | None = None, s: Session = Depends(session_dep)):
    try:
        return {
            "item": service.extract_and_match(
                s,
                job_id,
                ai_dependencies=_ai_dependencies(s),
                ai_options=(data or {}).get("ai_options"),
            )
        }
    except Exception as exc:
        _handle(exc)


@router.put("/quiz-generation-jobs/{job_id}/matching")
def api_update_matching(job_id: str, data: dict, s: Session = Depends(session_dep)):
    try:
        return {"item": service.update_matching(s, job_id, list(data.get("items") or []))}
    except Exception as exc:
        _handle(exc)


@router.post("/quiz-generation-jobs/{job_id}/matching/rematch")
def api_rematch_selected(job_id: str, data: dict, s: Session = Depends(session_dep)):
    try:
        return {
            "item": service.rematch_selected(
                s, job_id, [str(value) for value in data.get("item_ids") or []]
            )
        }
    except Exception as exc:
        _handle(exc)


@router.post("/quiz-generation-jobs/{job_id}/generate-preview")
def api_generate_preview(job_id: str, s: Session = Depends(session_dep)):
    try:
        return {"item": service.generate_preview(s, job_id)}
    except Exception as exc:
        _handle(exc)


@router.post("/quiz-generation-jobs/{job_id}/mark-saved")
def api_mark_saved(job_id: str, s: Session = Depends(session_dep)):
    try:
        return {"item": service.mark_saved(s, job_id)}
    except Exception as exc:
        _handle(exc)
