from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import get_session
from memory_anki.modules.dashboard.application.service import (
    DashboardQueryError,
    build_dashboard_payload,
)

router = APIRouter(tags=["dashboard"])


def session_dep():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


@router.get("/dashboard")
def api_dashboard(
    duration_mode: str | None = Query(default=None),
    month: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    session: Session = Depends(session_dep),
):
    try:
        return build_dashboard_payload(
            session,
            duration_mode=duration_mode,
            month=month,
            start_date=start_date,
            end_date=end_date,
        )
    except DashboardQueryError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
