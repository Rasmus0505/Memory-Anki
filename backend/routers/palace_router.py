from typing import Optional
from fastapi import APIRouter, UploadFile, File, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from models import get_session, Palace, Attachment as AttachmentModel, Peg
from schemas import PalaceCreate, PalaceUpdate
from services.palace_service import (
    list_palaces, get_palace, create_palace, update_palace, delete_palace,
)
from services.review_service import trigger_review_for_palace
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


def palace_json(p) -> dict:
    return {
        "id": p.id, "title": p.title, "description": p.description,
        "difficulty": p.difficulty, "review_mode": p.review_mode,
        "archived": p.archived, "mastered": p.mastered,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "pegs": [peg_json(peg) for peg in p.pegs],
        "attachments": [{"id": a.id, "filename": a.filename,
                         "original_name": a.original_name, "file_size": a.file_size}
                        for a in p.attachments],
        "chapters": [{"id": c.id, "name": c.name, "subject_id": c.subject_id,
                      "subject": {"id": c.subject.id, "name": c.subject.name} if c.subject else None}
                      for c in p.chapters],
    }


@router.get("/palaces")
def api_list(difficulty: Optional[int] = None, search: str = "",
             s: Session = Depends(session_dep)):
    return [palace_json(p) for p in list_palaces(s, difficulty, search)]


@router.get("/palaces/{palace_id}")
def api_get(palace_id: int, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    return {"error": "not found"} if not p else palace_json(p)


@router.post("/palaces")
def api_create(data: PalaceCreate, s: Session = Depends(session_dep)):
    palace = create_palace(s, data)
    trigger_review_for_palace(s, palace.id)
    return palace_json(palace)


@router.put("/palaces/{palace_id}")
def api_update(palace_id: int, data: PalaceUpdate, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        return {"error": "not found"}
    return palace_json(update_palace(s, p, data))


@router.delete("/palaces/{palace_id}")
def api_delete(palace_id: int, s: Session = Depends(session_dep)):
    delete_palace(s, palace_id)
    return {"ok": True}


@router.put("/palaces/{palace_id}/archive")
def api_archive(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        return {"error": "not found"}
    p.archived = data.get("archived", True)
    s.commit()
    return {"ok": True, "archived": p.archived}


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
