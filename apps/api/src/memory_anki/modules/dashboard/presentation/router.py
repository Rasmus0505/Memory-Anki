from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.dashboard.application.heatmap_service import build_heatmap_payload
from memory_anki.modules.dashboard.application.service import (
    DashboardQueryError,
    build_dashboard_payload,
    build_weekly_report_payload,
)

router = APIRouter(tags=["dashboard"])


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


@router.get("/dashboard/heatmap")
def api_dashboard_heatmap(
    days: int = Query(default=182),
    session: Session = Depends(session_dep),
):
    return build_heatmap_payload(session, days)


@router.get("/dashboard/weekly-report")
def api_weekly_report(
    offset_weeks: int = Query(default=1),
    session: Session = Depends(session_dep),
):
    return build_weekly_report_payload(session, offset_weeks=offset_weeks)
