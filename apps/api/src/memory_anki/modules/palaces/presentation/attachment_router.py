from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palaces.application.attachment_service import (
    create_attachment,
    delete_attachment,
    resolve_attachment_download,
)
from memory_anki.modules.palaces.presentation.errors import raise_not_found

router = APIRouter()


def _maybe_create_rolling_backup(*args, **kwargs):
    from memory_anki.modules.palaces.presentation import router as palace_router

    return palace_router.maybe_create_rolling_backup(*args, **kwargs)


def _attachments_dir() -> Path:
    from memory_anki.modules.palaces.presentation import router as palace_router

    return palace_router.ATTACHMENTS_DIR


@router.post("/palaces/{palace_id}/upload")
async def api_upload(palace_id: int, file: UploadFile = File(...),
                     s: Session = Depends(session_dep)):
    original_name = file.filename or "file"
    attachment = create_attachment(
        s,
        palace_id=palace_id,
        original_name=original_name,
        content=await file.read(),
        attachments_dir=_attachments_dir(),
    )
    if attachment is None:
        raise_not_found()
    _maybe_create_rolling_backup("rolling-attachment-upload")
    return {
        "id": attachment.id,
        "filename": attachment.filename,
        "original_name": attachment.original_name,
    }


@router.get("/attachments/{att_id}")
def api_attachment(att_id: int, s: Session = Depends(session_dep)):
    try:
        download = resolve_attachment_download(s, att_id, _attachments_dir())
    except FileNotFoundError:
        raise_not_found("file missing")
    if download is None:
        raise_not_found()
    return FileResponse(download.path, filename=download.original_name)


@router.delete("/attachments/{att_id}")
def api_attachment_delete(att_id: int, s: Session = Depends(session_dep)):
    if delete_attachment(s, att_id, _attachments_dir()):
        _maybe_create_rolling_backup("rolling-attachment-delete")
    return {"ok": True}
