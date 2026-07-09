import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Attachment as AttachmentModel
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palaces.application.palace_service import get_palace
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
    p = get_palace(s, palace_id)
    if not p:
        raise_not_found()
    ext = Path(file.filename or "file").suffix
    unique_name = f"{uuid.uuid4().hex}{ext}"
    (_attachments_dir() / unique_name).write_bytes(await file.read())
    att = AttachmentModel(palace_id=palace_id, filename=unique_name,
                          original_name=file.filename or "file", file_size=0)
    s.add(att)
    s.commit()
    _maybe_create_rolling_backup("rolling-attachment-upload")
    return {"id": att.id, "filename": unique_name, "original_name": att.original_name}


@router.get("/attachments/{att_id}")
def api_attachment(att_id: int, s: Session = Depends(session_dep)):
    att = s.query(AttachmentModel).filter_by(id=att_id).first()
    if not att:
        raise_not_found()
    fp = _attachments_dir() / att.filename
    if not fp.exists():
        raise_not_found("file missing")
    return FileResponse(fp, filename=att.original_name)


@router.delete("/attachments/{att_id}")
def api_attachment_delete(att_id: int, s: Session = Depends(session_dep)):
    att = s.query(AttachmentModel).filter_by(id=att_id).first()
    if att:
        fp = _attachments_dir() / att.filename
        if fp.exists():
            fp.unlink()
        s.delete(att)
        s.commit()
        _maybe_create_rolling_backup("rolling-attachment-delete")
    return {"ok": True}
