from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.search.application.search_service import global_search

router = APIRouter(tags=["search"])


@router.get("/search")
def api_global_search(
    q: str = Query(default=""),
    limit: int = Query(default=10),
    session: Session = Depends(session_dep),
):
    return global_search(session, q, limit)
