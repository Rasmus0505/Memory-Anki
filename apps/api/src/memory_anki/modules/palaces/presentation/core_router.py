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
    set_palace_archived,
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
from memory_anki.modules.reviews.api import (
    trigger_review_for_palace,
)
from memory_anki.modules.settings.api import SettingsAiRuntimeProvider, SettingsPromptCatalog
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
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
    ai_runtime = SettingsAiRuntimeProvider(s)
    result = suggest_peg_associations(
        s,
        palace_id,
        knowledge_text=data.knowledge_text,
        chapter_ids=data.chapter_ids,
        max_suggestions=data.max_suggestions,
        use_ai=data.use_ai,
        ai_options=ai_runtime.normalize_options(data.ai_options),
        ai_runtime=ai_runtime,
        prompt_catalog=SettingsPromptCatalog(s),
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
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    def prepare_atomic_side_effects(palace) -> None:
        trigger_review_for_palace(s, palace.id, commit=False)
        mutation_store.save(mutation_identity, palace_json(palace, s))

    palace = create_palace(
        s,
        data,
        uow=SqlAlchemyUnitOfWork(s),
        before_commit=prepare_atomic_side_effects,
    )
    _maybe_create_rolling_backup("rolling-create-palace")
    return palace_json(palace, s)


@router.put("/palaces/{palace_id}", response_model=PalaceDetailResponse)
def api_update(palace_id: int, data: PalaceUpdate, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        raise_not_found()
    updated = update_palace(
        s,
        p,
        data,
        uow=SqlAlchemyUnitOfWork(s),
    )
    _maybe_create_rolling_backup("rolling-update-palace")
    return palace_json(updated, s)


@router.delete("/palaces/{palace_id}", response_model=DeleteOkResponse)
def api_delete(palace_id: int, s: Session = Depends(session_dep)):
    delete_palace(s, palace_id, uow=SqlAlchemyUnitOfWork(s))
    return {"ok": True}


@router.post("/palaces/{palace_id}/restore", response_model=PalaceDetailResponse)
def api_restore_deleted_palace(palace_id: int, s: Session = Depends(session_dep)):
    palace = restore_deleted_palace(
        s,
        palace_id,
        uow=SqlAlchemyUnitOfWork(s),
    )
    if not palace:
        raise_not_found()
    return palace_json(palace, s)


@router.put("/palaces/{palace_id}/archive")
def api_archive(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    p = get_palace(s, palace_id)
    if not p:
        raise_not_found()
    palace = set_palace_archived(
        s,
        p,
        bool(data.get("archived", True)),
        uow=SqlAlchemyUnitOfWork(s),
    )
    return {"ok": True, "archived": palace.archived}


@router.get("/palaces/{palace_id}/review-plan")
def api_review_plan(palace_id: int, s: Session = Depends(session_dep)):
    plan = build_palace_review_plan(s, palace_id)
    if plan is None:
        raise_not_found()
    return plan
