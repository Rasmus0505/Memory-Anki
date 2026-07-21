from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palaces.application.palace_serializer import (
    palace_card_json,
    palace_json,
    palace_summary_json,
)
from memory_anki.modules.palaces.application.palace_service import (
    count_palaces,
    list_catalog_palaces,
    list_catalog_palaces_by_subject,
    list_deleted_palaces,
    list_palaces,
)
from memory_anki.modules.palaces.application.palace_template_service import (
    PalaceTemplateError,
    create_template_from_palace,
    delete_template,
    instantiate_template,
    list_templates,
)
from memory_anki.modules.palaces.application.title_sync_service import (
    build_chapter_grouped_palace_list,
    build_grouped_palace_list,
    build_subject_shelf_summary,
    get_explicit_chapter_ids_by_palace,
)
from memory_anki.modules.palaces.presentation.response_models import PalaceListResponse
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter()


def _precomputed_palace_serialization_context(s: Session, palaces) -> tuple[dict[int, set[int]], list[str]]:
    palace_ids = [p.id for p in palaces]
    explicit_map = get_explicit_chapter_ids_by_palace(s, palace_ids)
    return explicit_map, []


@router.get("/palaces", response_model=PalaceListResponse)
def api_list(
    search: str = "",
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    s: Session = Depends(session_dep),
):
    if limit is None:
        palaces = list_palaces(s, search)
        explicit_map, stage_labels = _precomputed_palace_serialization_context(
            s,
            palaces,
        )
        return [
            palace_json(
                p,
                s,
                precomputed_explicit_chapter_ids=explicit_map.get(p.id, set()),
                precomputed_stage_labels=stage_labels,
            )
            for p in palaces
        ]
    palaces = list_palaces(s, search, limit=limit, offset=offset)
    explicit_map, stage_labels = _precomputed_palace_serialization_context(
        s,
        palaces,
    )
    items = [
        palace_json(
            p,
            s,
            precomputed_explicit_chapter_ids=explicit_map.get(p.id, set()),
            precomputed_stage_labels=stage_labels,
        )
        for p in palaces
    ]
    return {
        "items": items,
        "total": count_palaces(s, search),
        "limit": limit,
        "offset": offset,
    }


def _cached_palace_serializer(serialize_fn, palaces, explicit_map, stage_labels):
    """Serialize each palace once; chapter + model grouping share the same payload."""
    cache: dict[int, dict] = {}

    def serialize(palace, session):
        cached = cache.get(palace.id)
        if cached is not None:
            return dict(cached)
        payload = serialize_fn(
            palace,
            session,
            precomputed_explicit_chapter_ids=explicit_map.get(palace.id, set()),
            precomputed_stage_labels=stage_labels,
        )
        cache[palace.id] = payload
        return dict(payload)

    return serialize


@router.get("/palaces/grouped")
def api_list_grouped(search: str = "", subject_id: int | None = None, s: Session = Depends(session_dep)):
    palaces = list_catalog_palaces_by_subject(s, subject_id, search)
    explicit_map, stage_labels = _precomputed_palace_serialization_context(s, palaces)
    serialize = _cached_palace_serializer(palace_card_json, palaces, explicit_map, stage_labels)
    chapter_grouped = build_chapter_grouped_palace_list(s, palaces, serialize)
    model_grouped = build_grouped_palace_list(s, palaces, serialize)
    return {
        "groups": model_grouped.get("groups", []),
        "ungrouped": model_grouped.get("ungrouped", []),
        "subjects": chapter_grouped.get("subjects", []),
    }


@router.get("/palaces/grouped-summary")
def api_list_grouped_summary(search: str = "", subject_id: int | None = None, s: Session = Depends(session_dep)):
    palaces = list_catalog_palaces_by_subject(s, subject_id, search)
    explicit_map, stage_labels = _precomputed_palace_serialization_context(s, palaces)
    serialize = _cached_palace_serializer(palace_summary_json, palaces, explicit_map, stage_labels)
    chapter_grouped = build_chapter_grouped_palace_list(s, palaces, serialize)
    model_grouped = build_grouped_palace_list(s, palaces, serialize)
    return {
        "groups": model_grouped.get("groups", []),
        "ungrouped": model_grouped.get("ungrouped", []),
        "subjects": chapter_grouped.get("subjects", []),
    }


@router.get("/palaces/subjects")
def api_list_subject_shelf(search: str = "", s: Session = Depends(session_dep)):
    palaces = list_catalog_palaces(s, search)
    return build_subject_shelf_summary(s, palaces)


@router.get("/palace-templates")
def api_list_palace_templates(s: Session = Depends(session_dep)):
    return {"items": list_templates(s)}


@router.post("/palace-templates")
def api_create_palace_template(data: dict, s: Session = Depends(session_dep)):
    try:
        item = create_template_from_palace(
            s,
            int(data.get("palace_id") or 0),
            str(data.get("name") or ""),
            str(data.get("description") or ""),
            uow=SqlAlchemyUnitOfWork(s),
        )
    except PalaceTemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": item}


@router.delete("/palace-templates/{template_id}")
def api_delete_palace_template(template_id: int, s: Session = Depends(session_dep)):
    return {
        "ok": delete_template(s, template_id, uow=SqlAlchemyUnitOfWork(s))
    }


@router.post("/palace-templates/{template_id}/instantiate")
def api_instantiate_palace_template(
    template_id: int,
    data: dict,
    request: Request,
    s: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    response: dict = {}

    def prepare_atomic_side_effects(palace) -> None:
        response.update(palace_json(palace, s))
        mutation_store.save(mutation_identity, response)

    try:
        instantiate_template(
            s,
            template_id,
            str(data.get("title") or ""),
            uow=SqlAlchemyUnitOfWork(s),
            before_commit=prepare_atomic_side_effects,
        )
    except PalaceTemplateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return response


@router.get("/palaces/deleted")
def api_list_deleted_palaces(s: Session = Depends(session_dep)):
    return {
        "items": [
            {
                "id": palace.id,
                "title": palace.title,
                "deleted_at": palace.deleted_at.isoformat() if palace.deleted_at else None,
            }
            for palace in list_deleted_palaces(s)
        ]
    }
