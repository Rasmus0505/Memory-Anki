from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.mindmap_learning.application.learning_service import (
    create_recall_event,
    list_node_mastery,
    list_session_events,
    set_node_label,
)
from memory_anki.modules.mindmap_learning.domain.schemas import (
    NodeLabelUpdate,
    RecallEventCreate,
)

router = APIRouter(prefix="/mindmap", tags=["mindmap"])


@router.post("/recall-events")
def api_create_recall_event(data: RecallEventCreate, session: Session = Depends(session_dep)):
    try:
        return {"item": create_recall_event(session, data.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/recall-events/session/{study_session_id}")
def api_list_session_events(study_session_id: str, session: Session = Depends(session_dep)):
    return {"items": list_session_events(session, study_session_id)}


@router.get("/palaces/{palace_id}/node-mastery")
def api_list_node_mastery(
    palace_id: int,
    weak_only: bool = Query(default=False),
    session: Session = Depends(session_dep),
):
    return {"items": list_node_mastery(session, palace_id, weak_only=weak_only)}


@router.put("/palaces/{palace_id}/node-labels/{node_uid}")
def api_set_node_label(
    palace_id: int,
    node_uid: str,
    data: NodeLabelUpdate,
    session: Session = Depends(session_dep),
):
    try:
        return {"item": set_node_label(session, palace_id, node_uid, data.label)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
