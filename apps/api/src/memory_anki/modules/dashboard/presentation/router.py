import hashlib
import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from memory_anki.core.runtime_paths import get_app_home
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

logger = logging.getLogger(__name__)
router = APIRouter(tags=["dashboard"])

# The product choice is "wait for the latest result, never show an old count".
# The cache therefore only coalesces simultaneous reads; it is invalidated by
# every successful mutation through request_dashboard_refresh().
_DASHBOARD_SNAPSHOT_TTL_SECONDS = 5.0
_dashboard_lock = threading.Lock()
_dashboard_build_lock = threading.Lock()
_dashboard_snapshot: tuple["_DashboardScope", float, dict, int] | None = None
_dashboard_generation = 0


class _DashboardScope:
    def __init__(self, session: Session) -> None:
        bind = session.get_bind()
        self.engine = bind
        home = get_app_home().resolve()
        database = str(getattr(bind, "url", ""))
        self.scope_key = hashlib.sha256(f"{home}|{database}".encode()).hexdigest()[:24]

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _DashboardScope) and self.engine is other.engine and self.scope_key == other.scope_key


def _snapshot_metadata(status: str, generated_at: str | None, scope: _DashboardScope, pending: bool) -> dict[str, Any]:
    return {
        "status": status,
        "generated_at": generated_at,
        "scope": scope.scope_key,
        "refresh_pending": pending,
    }


def _set_snapshot(
    scope: _DashboardScope,
    payload: dict,
    generated_at: str,
    generation: int,
) -> dict:
    result = dict(payload)
    result["snapshot"] = _snapshot_metadata("ready", generated_at, scope, False)
    with _dashboard_lock:
        global _dashboard_snapshot
        _dashboard_snapshot = (scope, time.monotonic(), result, generation)
    return result


def request_dashboard_refresh() -> None:
    """Invalidate the cached aggregate after a successful mutation."""
    global _dashboard_generation
    with _dashboard_lock:
        _dashboard_generation += 1


def _fresh_snapshot(scope: _DashboardScope) -> dict | None:
    with _dashboard_lock:
        snapshot = _dashboard_snapshot
        generation = _dashboard_generation
    if snapshot is None:
        return None
    if snapshot[0] != scope or snapshot[3] != generation:
        return None
    if time.monotonic() - snapshot[1] >= _DASHBOARD_SNAPSHOT_TTL_SECONDS:
        return None
    payload = dict(snapshot[2])
    metadata = dict(payload.get("snapshot") or {})
    metadata["status"] = "ready"
    metadata["refresh_pending"] = False
    payload["snapshot"] = metadata
    return payload


@router.get("/dashboard")
def api_dashboard(session: Session = Depends(session_dep)):
    scope = _DashboardScope(session)
    cached = _fresh_snapshot(scope)
    if cached is not None:
        return cached

    # A data-less "pending" body violates DashboardResponse (and the page
    # dereferences today_new_palaces immediately), so the request always waits
    # for a complete aggregate. The build lock coalesces simultaneous cold reads.
    with _dashboard_build_lock:
        cached = _fresh_snapshot(scope)
        if cached is not None:
            return cached
        with _dashboard_lock:
            generation = _dashboard_generation
        payload = build_dashboard_payload(session)
        generated_at = datetime.now(UTC).isoformat()
        return _set_snapshot(scope, payload, generated_at, generation)


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
