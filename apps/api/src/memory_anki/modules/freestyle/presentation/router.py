from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import get_session
from memory_anki.modules.freestyle.application.feed_service import (
    FREESTYLE_RANGE_ALL,
    build_freestyle_feed,
)

router = APIRouter(tags=["freestyle"])


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


@router.get("/freestyle/feed")
def api_freestyle_feed(
    range_: str = Query(FREESTYLE_RANGE_ALL, alias="range"),
    palace_ids: str | None = Query(None),
    content_types: str | None = Query(None),
    session: Session = Depends(session_dep),
):
    try:
        return build_freestyle_feed(
            session,
            range_value=range_,
            palace_ids_value=palace_ids,
            content_types_value=content_types,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

