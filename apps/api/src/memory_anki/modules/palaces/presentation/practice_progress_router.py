from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palaces.application.palace_service import get_palace
from memory_anki.modules.palaces.presentation.errors import raise_not_found
from memory_anki.modules.sessions.api import (
    clear_practice_progress,
    get_practice_progress,
    upsert_practice_progress,
)

router = APIRouter()


@router.get("/practice/session/{palace_id}")
def api_get_practice_progress(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    return {"progress": get_practice_progress(s, palace_id)}


@router.put("/practice/session/{palace_id}")
def api_upsert_practice_progress(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    return {"progress": upsert_practice_progress(s, palace_id, data)}


@router.delete("/practice/session/{palace_id}")
def api_delete_practice_progress(palace_id: int, s: Session = Depends(session_dep)):
    clear_practice_progress(s, palace_id)
    return {"ok": True}
