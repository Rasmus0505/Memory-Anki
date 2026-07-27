from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.memory.application.scheduling.unit_regroup import (
    execute_unit_regroup,
    preview_unit_regroup,
    rollback_unit_regroup,
    simulate_cohesion,
)

router = APIRouter(tags=["review"])

def _args(data: dict):
    return int(data["palace_id"]), data.get("unit_root_uid")

@router.post("/review/units/regroup/preview")
def preview(data: dict, session: Session = Depends(session_dep)):
    try:
        palace_id, unit_root_uid = _args(data)
        return {"item": preview_unit_regroup(session, palace_id=palace_id, unit_root_uid=unit_root_uid)}
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.post("/review/units/regroup/execute")
def execute(data: dict, session: Session = Depends(session_dep)):
    try:
        palace_id, unit_root_uid = _args(data)
        item = execute_unit_regroup(session, palace_id=palace_id, operation_id=str(data["operation_id"]), palace_revision=str(data["palace_revision"]), unit_root_uid=unit_root_uid)
        return {"item": item}
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.post("/review/units/regroup/rollback")
def rollback(data: dict, session: Session = Depends(session_dep)):
    try:
        item = rollback_unit_regroup(session, operation_id=str(data["operation_id"]))
        return {"item": item}
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.post("/review/units/simulate-cohesion")
def simulate(data: dict, session: Session = Depends(session_dep)):
    try:
        palace_id, unit_root_uid = _args(data)
        return {"item": simulate_cohesion(session, palace_id=palace_id, unit_root_uid=unit_root_uid)}
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
