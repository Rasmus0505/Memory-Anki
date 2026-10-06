"""Explicit scoped article transfer endpoints; no legacy Peg-dialect import."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.backups.api import create_rescue_snapshot
from memory_anki.modules.content.application.article_package import (
    ArticleTransferCommand,
    EditorStateConflictError,
    apply_article_transfer,
    export_article_package,
)
from memory_anki.modules.content.infrastructure.article_package_transaction import (
    ArticlePackageParticipant,
)
from memory_anki.modules.content.presentation.editor_router import (
    _run_rolling_backup_after_response,
)
from memory_anki.platform.persistence import SqlAlchemyUnitOfWork

router = APIRouter()


@router.get("/palaces/{palace_id}/article-package")
def get_article_package(palace_id: int, s: Session = Depends(session_dep)):
    try:
        return export_article_package(s, palace_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _apply(command: ArticleTransferCommand, palace_id: int | None, background_tasks: BackgroundTasks, session: Session):
    from memory_anki.modules.content.presentation.router import ATTACHMENTS_DIR

    def backup_before_write() -> None:
        create_rescue_snapshot(f"before-article-transfer-{palace_id}")

    try:
        result = apply_article_transfer(session, command, palace_id=palace_id, attachments_dir=ATTACHMENTS_DIR, participant=ArticlePackageParticipant(session), uow=SqlAlchemyUnitOfWork(session), before_write=backup_before_write)
    except EditorStateConflictError as exc:
        raise HTTPException(409, {"code": "mindmap_conflict", "message": str(exc), "remoteSnapshot": exc.current_snapshot}) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    background_tasks.add_task(_run_rolling_backup_after_response)
    return result


@router.post("/content/article-transfer")
def create_article_palace(command: ArticleTransferCommand, background_tasks: BackgroundTasks, s: Session = Depends(session_dep)):
    return _apply(command, None, background_tasks, s)


@router.post("/palaces/{palace_id}/article-transfer")
def transfer_article(palace_id: int, command: ArticleTransferCommand, background_tasks: BackgroundTasks, s: Session = Depends(session_dep)):
    return _apply(command, palace_id, background_tasks, s)
