from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palaces.application.palace_serializer import palace_json
from memory_anki.modules.palaces.application.palace_service import (
    create_palace,
    delete_palace,
    get_palace,
    restore_deleted_palace,
    unarchive_palace,
    update_palace,
)
from memory_anki.modules.palaces.application.peg_association_service import (
    MAX_SUGGESTIONS_LIMIT,
    suggest_peg_associations,
)
from memory_anki.modules.palaces.application.review_plan_service import (
    build_palace_review_plan,
)
from memory_anki.modules.palaces.domain.schemas import PalaceCreate, PalaceUpdate
from memory_anki.modules.palaces.presentation.errors import raise_not_found
from memory_anki.modules.palaces.presentation.response_models import (
    DeleteOkResponse,
    PalaceDetailResponse,
    PalaceSummaryResponse,
)
from memory_anki.modules.persistence.application.idempotency import (
    get_idempotent_response,
    save_idempotent_response,
)
from memory_anki.modules.reviews.application.review_execution_service import (
    trigger_review_for_palace,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    normalize_ai_runtime_options,
)

router = APIRouter()


class PegAssociationSuggestionRequest(BaseModel):
    knowledge_text: str = ""
    chapter_ids: list[int] = Field(default_factory=list)
    max_suggestions: int = Field(default=5, ge=1, le=MAX_SUGGESTIONS_LIMIT)
    use_ai: bool = True
    ai_options: dict[str, Any] | None = None


def _maybe_create_rolling_backup(*args, **kwargs):
    from memory_anki.modules.palaces.presentation import router as palace_router

    return palace_router.maybe_create_rolling_backup(*args, **kwargs)


@router.get("/palaces/{palace_id}", response_model=PalaceDetailResponse)
def api_get(palace_id: int, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        raise_not_found()
    return palace_json(p, s)


@router.post("/palaces/{palace_id}/peg-association-suggestions")
def api_suggest_peg_associations(
    palace_id: int,
    data: PegAssociationSuggestionRequest,
    s: Session = Depends(session_dep),
):
    result = suggest_peg_associations(
        s,
        palace_id,
        knowledge_text=data.knowledge_text,
        chapter_ids=data.chapter_ids,
        max_suggestions=data.max_suggestions,
        use_ai=data.use_ai,
        ai_options=normalize_ai_runtime_options(data.ai_options),
    )
    if result is None:
        raise_not_found()
    return result


@router.post("/palaces", response_model=PalaceSummaryResponse)
def api_create(
    data: PalaceCreate,
    request: Request,
    s: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(s, request)
    if existing_response is not None:
        return existing_response
    palace = create_palace(s, data)
    trigger_review_for_palace(s, palace.id)
    _maybe_create_rolling_backup("rolling-create-palace")
    response = palace_json(palace, s)
    save_idempotent_response(s, request, response)
    return response


@router.put("/palaces/{palace_id}", response_model=PalaceDetailResponse)
def api_update(palace_id: int, data: PalaceUpdate, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        raise_not_found()
    updated = update_palace(s, p, data)
    _maybe_create_rolling_backup("rolling-update-palace")
    return palace_json(updated, s)


@router.delete("/palaces/{palace_id}", response_model=DeleteOkResponse)
def api_delete(palace_id: int, s: Session = Depends(session_dep)):
    delete_palace(s, palace_id)
    return {"ok": True}


@router.post("/palaces/{palace_id}/restore", response_model=PalaceDetailResponse)
def api_restore_deleted_palace(palace_id: int, s: Session = Depends(session_dep)):
    palace = restore_deleted_palace(s, palace_id)
    if not palace:
        raise_not_found()
    return palace_json(palace, s)


@router.put("/palaces/{palace_id}/archive")
def api_archive(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        raise_not_found()
    palace = unarchive_palace(s, p)
    return {"ok": True, "archived": palace.archived}


@router.get("/palaces/{palace_id}/review-plan")
def api_review_plan(palace_id: int, s: Session = Depends(session_dep)):
    plan = build_palace_review_plan(s, palace_id)
    if plan is None:
        raise_not_found()
    return plan
