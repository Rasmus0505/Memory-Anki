import threading

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.dashboard.application.heatmap_service import build_heatmap_payload
from memory_anki.modules.dashboard.application.learning_progress import (
    LearningProgressResponse,
    build_learning_progress,
)
from memory_anki.modules.dashboard.application.service import (
    build_dashboard_payload,
    build_weekly_report_payload,
)

router = APIRouter(tags=["dashboard"])

# A 20s client timeout retries this route. Sharing one in-flight payload keeps
# those retries from stacking the same ledger fold and palace projection.
_dashboard_lock = threading.Lock()
_dashboard_flight: "_DashboardFlight | None" = None


class _DashboardFlight:
    def __init__(self) -> None:
        self.event = threading.Event()
        self.result: dict | None = None
        self.error: BaseException | None = None


@router.get("/dashboard")
def api_dashboard(
    session: Session = Depends(session_dep),
):
    global _dashboard_flight
    with _dashboard_lock:
        flight = _dashboard_flight
        if flight is None:
            flight = _DashboardFlight()
            _dashboard_flight = flight
            owner = True
        else:
            owner = False
    if not owner:
        flight.event.wait()
        if flight.error is not None:
            raise flight.error
        return flight.result
    try:
        flight.result = build_dashboard_payload(session)
        return flight.result
    except BaseException as exc:
        flight.error = exc
        raise
    finally:
        flight.event.set()
        with _dashboard_lock:
            if _dashboard_flight is flight:
                _dashboard_flight = None


@router.get("/dashboard/learning-progress", response_model=LearningProgressResponse)
def api_learning_progress(session: Session = Depends(session_dep)):
    return build_learning_progress(session)


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
