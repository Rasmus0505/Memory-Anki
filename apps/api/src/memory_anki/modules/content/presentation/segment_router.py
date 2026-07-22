from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.content.application.palace_serializer import palace_json
from memory_anki.modules.content.application.palace_service import (
    get_palace,
    set_palace_practice_flag,
)
from memory_anki.modules.content.application.segment_review_service import (
    build_palace_default_segment_summary,
    build_segment_editor_doc,
    list_palace_segments,
    segment_summary_json,
)
from memory_anki.modules.content.application.segment_service import (
    create_palace_segment,
    delete_palace_segment,
    get_palace_segment,
    update_palace_segment,
)
from memory_anki.modules.content.presentation.errors import raise_not_found
from memory_anki.platform.application import mutation_identity_from_headers
from memory_anki.platform.persistence import (
    SqlAlchemyMutationResponseStore,
    SqlAlchemyUnitOfWork,
)

router = APIRouter()


def _maybe_create_rolling_backup(*args, **kwargs):
    from memory_anki.modules.content.presentation import router as palace_router

    return palace_router.maybe_create_rolling_backup(*args, **kwargs)


@router.get("/palaces/{palace_id}/segments")
def api_list_segments(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    default_segment = build_palace_default_segment_summary(s, palace)
    return {"items": list_palace_segments(s, palace, default_segment_payload=default_segment)}


@router.post("/palaces/{palace_id}/segments")
def api_create_segment(
    palace_id: int,
    data: dict,
    request: Request,
    s: Session = Depends(session_dep),
):
    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    response: dict = {}

    def prepare_atomic_response(segment) -> None:
        response.update({"item": segment_summary_json(s, segment)})
        mutation_store.save(mutation_identity, response)

    create_palace_segment(
        s,
        palace,
        data,
        uow=SqlAlchemyUnitOfWork(s),
        before_commit=prepare_atomic_response,
    )
    _maybe_create_rolling_backup("rolling-create-palace-segment")
    return response


@router.put("/palace-segments/{segment_id}")
def api_update_segment(segment_id: int, data: dict, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment:
        raise_not_found()
    updated = update_palace_segment(
        s, segment, data, uow=SqlAlchemyUnitOfWork(s)
    )
    _maybe_create_rolling_backup("rolling-update-palace-segment")
    return {"item": segment_summary_json(s, updated)}


@router.put("/palaces/{palace_id}/practice-flag")
def api_update_palace_practice_flag(palace_id: int, data: dict, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    palace = set_palace_practice_flag(
        s,
        palace,
        bool(data.get("needs_practice", False)),
        uow=SqlAlchemyUnitOfWork(s),
    )
    return {"item": palace_json(palace, s)}

@router.delete("/palace-segments/{segment_id}")
def api_delete_segment(segment_id: int, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment:
        raise_not_found()
    delete_palace_segment(s, segment, uow=SqlAlchemyUnitOfWork(s))
    _maybe_create_rolling_backup("rolling-delete-palace-segment")
    return {"ok": True}


@router.get("/palace-segments/{segment_id}")
def api_get_segment(segment_id: int, s: Session = Depends(session_dep)):
    segment = get_palace_segment(s, segment_id)
    if not segment or not segment.palace:
        raise_not_found()
    return {
        "item": segment_summary_json(s, segment),
        "palace": palace_json(segment.palace, s),
        "editor_doc": build_segment_editor_doc(segment.palace, segment),
    }
