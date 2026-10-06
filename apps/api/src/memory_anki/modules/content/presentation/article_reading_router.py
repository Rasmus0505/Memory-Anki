from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.content.application.article_reading import (
    OWNER_PATTERN,
    ArticleReadingConflict,
    ArticleReadingResponse,
    ArticleReadingWrite,
    get_article_reading,
    save_article_reading,
)
from memory_anki.modules.content.infrastructure.article_reading_store import (
    SqlAlchemyArticleReadingStore,
)
from memory_anki.platform.persistence import SqlAlchemyUnitOfWork

router = APIRouter(prefix="/content/article-reading", tags=["article-reading"])
OwnerId = Annotated[str, Path(pattern=OWNER_PATTERN)]


@router.get("/{owner_id}", response_model=ArticleReadingResponse)
def api_get_article_reading(owner_id: OwnerId, s: Session = Depends(session_dep)) -> ArticleReadingResponse:
    return get_article_reading(SqlAlchemyArticleReadingStore(s), owner_id)


@router.put("/{owner_id}", response_model=ArticleReadingResponse)
def api_save_article_reading(
    owner_id: OwnerId,
    data: ArticleReadingWrite,
    s: Session = Depends(session_dep),
) -> ArticleReadingResponse:
    try:
        return save_article_reading(SqlAlchemyArticleReadingStore(s), owner_id, data, uow=SqlAlchemyUnitOfWork(s))
    except ArticleReadingConflict as exc:
        raise HTTPException(status_code=409, detail={
            "code": "article_reading_conflict",
            "message": str(exc),
            "remoteSnapshot": exc.snapshot.model_dump(mode="json"),
        }) from exc
