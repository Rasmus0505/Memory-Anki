from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.dashboard.application.heatmap_service import build_heatmap_payload
from memory_anki.modules.dashboard.application.service import (
    build_dashboard_payload,
    build_weekly_report_payload,
)

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def api_dashboard(
    session: Session = Depends(session_dep),
):
    return build_dashboard_payload(session)


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
