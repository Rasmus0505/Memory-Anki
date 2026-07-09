from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.palaces.application.mini_palace_service import (
    build_mini_palace_editor_doc,
    create_palace_mini_palace,
    delete_palace_mini_palace,
    get_palace_mini_palace,
    list_palace_mini_palaces,
    mini_palace_summary_json,
    update_palace_mini_palace,
)
from memory_anki.modules.palaces.application.palace_serializer import palace_json
from memory_anki.modules.palaces.application.palace_service import get_palace
from memory_anki.modules.palaces.presentation.errors import raise_not_found
from memory_anki.modules.persistence.application.idempotency import (
    get_idempotent_response,
    save_idempotent_response,
)

router = APIRouter()


def _maybe_create_rolling_backup(*args, **kwargs):
    from memory_anki.modules.palaces.presentation import router as palace_router

    return palace_router.maybe_create_rolling_backup(*args, **kwargs)


@router.get("/palaces/{palace_id}/mini-palaces")
def api_list_mini_palaces(palace_id: int, s: Session = Depends(session_dep)):
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    return {"items": list_palace_mini_palaces(s, palace)}


@router.post("/palaces/{palace_id}/mini-palaces")
def api_create_mini_palace(
    palace_id: int,
    data: dict,
    request: Request,
    s: Session = Depends(session_dep),
):
    existing_response = get_idempotent_response(s, request)
    if existing_response is not None:
        return existing_response
    palace = get_palace(s, palace_id)
    if not palace:
        raise_not_found()
    mini_palace = create_palace_mini_palace(s, palace, data)
    _maybe_create_rolling_backup("rolling-create-mini-palace")
    response = {"item": mini_palace_summary_json(mini_palace, s)}
    save_idempotent_response(s, request, response)
    return response


@router.get("/palace-mini-palaces/{mini_palace_id}")
def api_get_mini_palace(mini_palace_id: int, s: Session = Depends(session_dep)):
    mini_palace = get_palace_mini_palace(s, mini_palace_id)
    if not mini_palace or not mini_palace.palace:
        raise_not_found()
    return {
        "item": mini_palace_summary_json(mini_palace, s),
        "palace": palace_json(mini_palace.palace, s),
        "editor_doc": build_mini_palace_editor_doc(mini_palace.palace, mini_palace),
    }


@router.put("/palace-mini-palaces/{mini_palace_id}")
def api_update_mini_palace(mini_palace_id: int, data: dict, s: Session = Depends(session_dep)):
    mini_palace = get_palace_mini_palace(s, mini_palace_id)
    if not mini_palace:
        raise_not_found()
    updated = update_palace_mini_palace(s, mini_palace, data)
    _maybe_create_rolling_backup("rolling-update-mini-palace")
    return {"item": mini_palace_summary_json(updated, s)}


@router.delete("/palace-mini-palaces/{mini_palace_id}")
def api_delete_mini_palace(mini_palace_id: int, s: Session = Depends(session_dep)):
    mini_palace = get_palace_mini_palace(s, mini_palace_id)
    if not mini_palace:
        raise_not_found()
    delete_palace_mini_palace(s, mini_palace)
    _maybe_create_rolling_backup("rolling-delete-mini-palace")
    return {"ok": True}
