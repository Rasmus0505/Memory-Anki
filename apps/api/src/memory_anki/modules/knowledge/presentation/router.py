"""知识体系路由：学科 + 章节。"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.knowledge.application import chapter_service, subject_service
from memory_anki.modules.knowledge.application.editor_state_service import (
    EditorStateConflictError,
)
from memory_anki.modules.knowledge.domain.schemas import (
    ChapterCreate,
    ChapterUpdate,
    SubjectCreate,
    SubjectUpdate,
)
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter(tags=["knowledge"])
logger = logging.getLogger(__name__)


def _internal_error_response(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "detail": {
                "code": "internal_error",
                "message": message,
            }
        },
    )


# === 学科 ===


@router.get("/subjects")
def list_subjects(
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    s: Session = Depends(session_dep),
):
    return subject_service.list_subjects(s, limit=limit, offset=offset)


@router.post("/subjects")
def create_subject(data: SubjectCreate, request: Request, s: Session = Depends(session_dep)):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    payload = data.model_dump(exclude_unset=True, exclude_none=False)
    return subject_service.create_subject(
        s,
        name=payload.get("name", ""),
        color=payload.get("color", "#6366f1"),
        sort_order=payload.get("sort_order", 0),
        uow=SqlAlchemyUnitOfWork(s),
        before_commit=lambda response: mutation_store.save(
            mutation_identity, response
        ),
    )


@router.put("/subjects/{subject_id}")
def update_subject(subject_id: int, data: SubjectUpdate, s: Session = Depends(session_dep)):
    sub = subject_service.update_subject(
        s,
        subject_id,
        data.model_dump(exclude_unset=True, exclude_none=False),
        uow=SqlAlchemyUnitOfWork(s),
    )
    if sub is None:
        raise HTTPException(status_code=404, detail="not found")
    return sub


@router.delete("/subjects/{subject_id}")
def delete_subject(subject_id: int, s: Session = Depends(session_dep)):
    impact = subject_service.get_subject_delete_impact(s, subject_id)
    if impact is None:
        raise HTTPException(status_code=404, detail="not found")
    if impact["blocked"]:
        return JSONResponse(
            status_code=409,
            content={
                "ok": False,
                "requires_reassignment": True,
                **impact,
            },
        )
    deleted = subject_service.delete_subject(
        s,
        subject_id,
        uow=SqlAlchemyUnitOfWork(s),
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="not found")
    return {"ok": True}


# === 章节 ===


@router.get("/subjects/{subject_id}/tree")
def get_tree(subject_id: int, s: Session = Depends(session_dep)):
    """获取学科完整章节树"""
    tree = subject_service.get_subject_tree(s, subject_id)
    if tree is None:
        raise HTTPException(status_code=404, detail="not found")
    return tree


@router.get("/subjects/{subject_id}/editor")
def get_subject_editor(subject_id: int, s: Session = Depends(session_dep)):
    payload = subject_service.get_subject_editor_payload(s, subject_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="not found")
    return payload


@router.put("/subjects/{subject_id}/editor")
def update_subject_editor(subject_id: int, data: dict, s: Session = Depends(session_dep)):
    # Keep this as a free-form dict: the editor document/config payload is an
    # open-ended mind-map state owned by the editor subsystem.
    uow = SqlAlchemyUnitOfWork(s)
    try:
        payload = subject_service.save_subject_editor(s, subject_id, data, uow=uow)
        if payload is None:
            raise HTTPException(status_code=404, detail="not found")
        return payload
    except HTTPException:
        raise
    except EditorStateConflictError as exc:
        uow.rollback()
        return JSONResponse(
            status_code=409,
            content={
                "detail": {
                    "code": "mindmap_conflict",
                    "message": str(exc),
                    "remoteSnapshot": exc.current_snapshot,
                }
            },
        )
    except Exception:
        uow.rollback()
        logger.exception("update_subject_editor failed: subject_id=%s", subject_id)
        return _internal_error_response("保存学科编辑器状态失败，请查看服务端日志。")


@router.get("/chapters/{chapter_id}")
def get_chapter(chapter_id: int, s: Session = Depends(session_dep)):
    """获取章节详情 + 关联的宫殿列表"""
    detail = chapter_service.get_chapter_detail(s, chapter_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="not found")
    return detail


@router.post("/subjects/{subject_id}/chapters")
def create_chapter(
    subject_id: int,
    data: ChapterCreate,
    request: Request,
    s: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    uow = SqlAlchemyUnitOfWork(s)
    try:
        return chapter_service.create_chapter(
            s,
            subject_id,
            data,
            uow=uow,
            before_commit=lambda result: mutation_store.save(
                mutation_identity, result
            ),
        )
    except Exception:
        uow.rollback()
        logger.exception("create_chapter failed: subject_id=%s", subject_id)
        return _internal_error_response("创建章节失败，请查看服务端日志。")


@router.put("/chapters/{chapter_id}")
def update_chapter(chapter_id: int, data: ChapterUpdate, s: Session = Depends(session_dep)):
    chapter = chapter_service.update_chapter(
        s,
        chapter_id,
        data.model_dump(exclude_unset=True, exclude_none=False),
        uow=SqlAlchemyUnitOfWork(s),
    )
    if chapter is None:
        raise HTTPException(status_code=404, detail="not found")
    return chapter


@router.delete("/chapters/{chapter_id}")
def delete_chapter(chapter_id: int, force: bool = False, s: Session = Depends(session_dep)):
    try:
        result = chapter_service.delete_chapter(
            s,
            chapter_id,
            force=force,
            uow=SqlAlchemyUnitOfWork(s),
        )
        if result.get("requires_force"):
            return JSONResponse(status_code=409, content=result)
        return result
    except Exception:
        s.rollback()
        logger.exception("delete_chapter failed: chapter_id=%s", chapter_id)
        return _internal_error_response("删除章节失败，请查看服务端日志。")
