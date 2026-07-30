"""HTTP API for permanent-mark review units."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.memory.api import (
    adjust_unit_schedule,
    cancel_unrated_unit_review_encounter,
    close_unit_review_encounter,
    complete_unit_review_session,
    get_palace_ladder_progress,
    get_palace_unit_projection,
    get_unit_review_completion,
    get_unit_review_session,
    list_due_units,
    open_unit_review_encounter,
    rate_review_unit,
    reconcile_palace_units,
    start_freestyle_unit_review_session,
    start_unit_review_session,
    undo_content_schedule_batch,
    undo_unit_rating,
)

router = APIRouter(tags=["review"])


def _bad_request(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def _optional_nonnegative_seconds(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError("effective_seconds must be a non-negative integer")
    try:
        seconds = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("effective_seconds must be a non-negative integer") from exc
    if seconds < 0:
        raise ValueError("effective_seconds must be a non-negative integer")
    return seconds


@router.get("/review/queue")
def review_queue(session: Session = Depends(session_dep)):
    return {"items": list_due_units(session)}


@router.get("/review/palaces/{palace_id}/units")
def palace_units(palace_id: int, session: Session = Depends(session_dep)):
    try:
        return {"item": get_palace_unit_projection(session, palace_id)}
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.get("/review/palaces/{palace_id}/ladder-progress")
def palace_ladder_progress(
    palace_id: int,
    range: str = "all",
    unit_id: str | None = None,
    session: Session = Depends(session_dep),
):
    try:
        return {
            "item": get_palace_ladder_progress(
                session,
                palace_id,
                unit_id=unit_id,
                range_key=range,
            )
        }
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/review/palaces/{palace_id}/units/reconcile")
def reconcile_units(palace_id: int, session: Session = Depends(session_dep)):
    try:
        item = reconcile_palace_units(session, palace_id)
        session.commit()
        return {"item": item}
    except ValueError as exc:
        session.rollback()
        raise _bad_request(exc) from exc


@router.patch("/review/units/{unit_id}/schedule")
def patch_unit_schedule(
    unit_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    try:
        payload = data if isinstance(data, dict) else {}
        stage_raw = payload.get("stage_index", payload.get("stageIndex"))
        due_raw = payload.get("due_date", payload.get("dueDate"))
        passed_raw = payload.get("has_passed", payload.get("hasPassed"))
        item = adjust_unit_schedule(
            session,
            unit_id=unit_id,
            operation_id=str(payload.get("operation_id") or payload.get("operationId") or ""),
            stage_index=None if stage_raw is None else int(stage_raw),
            due_date=None if due_raw is None else due_raw,
            has_passed=None if passed_raw is None else bool(passed_raw),
            reason=str(payload.get("reason") or "manual_adjust"),
        )
        session.commit()
        return {"item": item}
    except (TypeError, ValueError) as exc:
        session.rollback()
        raise _bad_request(ValueError(str(exc))) from exc


@router.post("/review/palaces/{palace_id}/schedule-batches/{batch_id}/undo")
def undo_schedule_batch(
    palace_id: int,
    batch_id: str,
    data: dict | None = Body(default=None),
    session: Session = Depends(session_dep),
):
    try:
        payload = data if isinstance(data, dict) else {}
        item = undo_content_schedule_batch(
            session,
            batch_id,
            palace_id=palace_id,
            operation_id=payload.get("operation_id") or payload.get("operationId"),
        )
        session.commit()
        return {"item": item}
    except ValueError as exc:
        session.rollback()
        raise _bad_request(exc) from exc


@router.post("/review/palaces/{palace_id}/sessions")
def start_formal_session(
    palace_id: int,
    data: dict | None = Body(default=None),
    session: Session = Depends(session_dep),
):
    try:
        payload = data if isinstance(data, dict) else {}
        return {
            "item": start_unit_review_session(
                session,
                palace_id,
                client_source=payload.get("client_source") or payload.get("clientSource"),
            )
        }
    except ValueError as exc:
        raise _bad_request(exc) from exc


@router.post("/review/units/{unit_id}/sessions")
def start_freestyle_session(
    unit_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    try:
        return {
            "item": start_freestyle_unit_review_session(
                session,
                unit_id=unit_id,
                unit_revision=int(data.get("unit_revision") or 0),
                encounter_id=str(data.get("encounter_id") or ""),
                round_id=str(data.get("round_id") or ""),
                client_source=data.get("client_source") or data.get("clientSource"),
            )
        }
    except (TypeError, ValueError) as exc:
        session.rollback()
        raise _bad_request(ValueError(str(exc))) from exc


@router.post("/review/session/{study_session_id}/units/{unit_id}/encounters")
def open_encounter(
    study_session_id: str,
    unit_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    try:
        return {
            "item": open_unit_review_encounter(
                session,
                study_session_id=study_session_id,
                unit_id=unit_id,
                unit_revision=int(data.get("unit_revision") or 0),
                encounter_id=str(data.get("encounter_id") or ""),
                round_id=str(data.get("round_id") or ""),
            )
        }
    except (TypeError, ValueError) as exc:
        session.rollback()
        raise _bad_request(ValueError(str(exc))) from exc


@router.get("/review/session/{study_session_id}")
def session_detail(study_session_id: str, session: Session = Depends(session_dep)):
    try:
        return {"item": get_unit_review_session(session, study_session_id)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/review/session/{study_session_id}/units/{unit_id}/ratings")
def rate_unit(
    study_session_id: str,
    unit_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    try:
        rating = data.get("rating")
        if not isinstance(rating, int | str):
            raise ValueError("rating is required")
        return {
            "item": rate_review_unit(
                session,
                study_session_id=study_session_id,
                unit_id=unit_id,
                unit_revision=int(data.get("unit_revision") or 0),
                encounter_id=str(data.get("encounter_id") or ""),
                operation_id=str(data.get("operation_id") or ""),
                rating=rating,
            )
        }
    except (TypeError, ValueError) as exc:
        session.rollback()
        raise _bad_request(ValueError(str(exc))) from exc


@router.post(
    "/review/session/{study_session_id}/units/{unit_id}/encounters/{encounter_id}/close"
)
def close_encounter(
    study_session_id: str,
    unit_id: str,
    encounter_id: str,
    data: dict,
    session: Session = Depends(session_dep),
):
    try:
        return {
            "item": close_unit_review_encounter(
                session,
                study_session_id=study_session_id,
                unit_id=unit_id,
                encounter_id=encounter_id,
                operation_id=str(data.get("operation_id") or ""),
                effective_seconds=_optional_nonnegative_seconds(data.get("effective_seconds")),
            )
        }
    except ValueError as exc:
        session.rollback()
        raise _bad_request(exc) from exc


@router.post(
    "/review/session/{study_session_id}/units/{unit_id}/encounters/{encounter_id}/cancel"
)
def cancel_unrated_encounter(
    study_session_id: str,
    unit_id: str,
    encounter_id: str,
    session: Session = Depends(session_dep),
):
    """Drop an unrated freestyle glance so it cannot inflate later wall-clock duration."""
    try:
        return {
            "item": cancel_unrated_unit_review_encounter(
                session,
                study_session_id=study_session_id,
                unit_id=unit_id,
                encounter_id=encounter_id,
            )
        }
    except ValueError as exc:
        session.rollback()
        raise _bad_request(exc) from exc


@router.post("/review/ratings/{operation_id}/undo")
def undo_rating(operation_id: str, session: Session = Depends(session_dep)):
    try:
        return {"item": undo_unit_rating(session, operation_id)}
    except ValueError as exc:
        session.rollback()
        raise _bad_request(exc) from exc


@router.post("/review/session/{study_session_id}/complete")
def complete_session(study_session_id: str, session: Session = Depends(session_dep)):
    try:
        return {"item": complete_unit_review_session(session, study_session_id)}
    except ValueError as exc:
        session.rollback()
        raise _bad_request(exc) from exc


@router.get("/review/completions/{study_session_id}")
def completion(study_session_id: str, session: Session = Depends(session_dep)):
    try:
        return {"item": get_unit_review_completion(session, study_session_id)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
