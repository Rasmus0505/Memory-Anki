import hashlib
import json
import logging
import os
import threading
import time
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from memory_anki.core.config import CACHE_DIR
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

_DASHBOARD_SNAPSHOT_TTL_SECONDS = 300.0
_DASHBOARD_REFRESH_INTERVAL_SECONDS = 15.0
_DASHBOARD_SNAPSHOT_VERSION = 1
_dashboard_lock = threading.Lock()
_dashboard_snapshot_lock = threading.Lock()
_dashboard_snapshot: tuple["_DashboardScope", float, dict] | None = None
_dashboard_refresh_requested = threading.Event()
_dashboard_worker_stop = threading.Event()
_dashboard_worker: threading.Thread | None = None
_dashboard_refreshing = False
_dashboard_refresh_scope: "_DashboardScope | None" = None


class _DashboardScope:
    def __init__(self, session: Session) -> None:
        bind = session.get_bind()
        self.engine = bind
        home = get_app_home().resolve()
        database = str(getattr(bind, "url", ""))
        self.disk_key = hashlib.sha256(f"{home}|{database}".encode()).hexdigest()[:24]
        self.path = CACHE_DIR / "dashboard" / f"{self.disk_key}.json"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _DashboardScope) and self.engine is other.engine and self.disk_key == other.disk_key


def _snapshot_metadata(status: str, generated_at: str | None, scope: _DashboardScope, pending: bool) -> dict[str, Any]:
    return {
        "status": status,
        "generated_at": generated_at,
        "scope": scope.disk_key,
        "refresh_pending": pending,
    }


def _read_persisted_snapshot(scope: _DashboardScope) -> tuple[float, dict] | None:
    try:
        with scope.path.open("r", encoding="utf-8") as handle:
            envelope = json.load(handle)
        if envelope.get("version") != _DASHBOARD_SNAPSHOT_VERSION or envelope.get("scope") != scope.disk_key:
            return None
        payload = envelope.get("payload")
        generated_at = envelope.get("generated_at")
        if not isinstance(payload, dict) or not isinstance(generated_at, str):
            return None
        snapshot = dict(payload)
        snapshot["snapshot"] = _snapshot_metadata("stale", generated_at, scope, False)
        return time.monotonic(), snapshot
    except (OSError, ValueError, TypeError):
        return None


def _persist_snapshot(scope: _DashboardScope, payload: dict) -> str:
    from datetime import datetime, timezone
    generated_at = datetime.now(timezone.utc).isoformat()
    scope.path.parent.mkdir(parents=True, exist_ok=True)
    temp = scope.path.with_name(f".{scope.path.name}.{os.getpid()}.tmp")
    envelope = {"version": _DASHBOARD_SNAPSHOT_VERSION, "scope": scope.disk_key, "generated_at": generated_at, "payload": payload}
    with temp.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(envelope, handle, ensure_ascii=False, separators=(",", ":"))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, scope.path)
    return generated_at


def _set_snapshot(scope: _DashboardScope, payload: dict, generated_at: str) -> dict:
    result = dict(payload)
    result["snapshot"] = _snapshot_metadata("ready", generated_at, scope, False)
    with _dashboard_snapshot_lock:
        global _dashboard_snapshot
        _dashboard_snapshot = (scope, time.monotonic(), result)
    return result


def _request_refresh(scope: _DashboardScope) -> None:
    global _dashboard_refreshing, _dashboard_refresh_scope
    with _dashboard_lock:
        if _dashboard_refreshing:
            return
        _dashboard_refreshing = True
        _dashboard_refresh_scope = scope
    _dashboard_refresh_requested.set()


def _refresh_once(scope: _DashboardScope, session_factory) -> None:
    try:
        with session_factory() as refresh_session:
            payload = build_dashboard_payload(refresh_session)
        generated_at = _persist_snapshot(scope, payload)
        _set_snapshot(scope, payload, generated_at)
    except Exception:
        logger.exception("dashboard snapshot refresh failed")
    finally:
        global _dashboard_refreshing, _dashboard_refresh_scope
        with _dashboard_lock:
            _dashboard_refreshing = False
            _dashboard_refresh_scope = None


def _dashboard_worker_loop(session_factory) -> None:
    while not _dashboard_worker_stop.wait(_DASHBOARD_REFRESH_INTERVAL_SECONDS):
        with _dashboard_snapshot_lock:
            current = _dashboard_snapshot
        with _dashboard_lock:
            requested_scope = _dashboard_refresh_scope
            requested = _dashboard_refresh_requested.is_set()
        if current is None and requested_scope is None:
            continue
        scope = requested_scope or current[0]
        created = current[1] if current is not None and current[0] == scope else 0.0
        if time.monotonic() - created < _DASHBOARD_SNAPSHOT_TTL_SECONDS and not requested:
            continue
        _dashboard_refresh_requested.clear()
        _refresh_once(scope, session_factory)


def start_dashboard_snapshot_worker(session_factory=None) -> threading.Thread:
    global _dashboard_worker
    with _dashboard_lock:
        if _dashboard_worker is not None and _dashboard_worker.is_alive():
            return _dashboard_worker
        _dashboard_worker_stop.clear()
        factory = session_factory
        if factory is None:
            from memory_anki.infrastructure.db._tables._base import get_session
            factory = get_session
        _dashboard_worker = threading.Thread(target=_dashboard_worker_loop, args=(factory,), name="dashboard-snapshot-worker", daemon=True)
        _dashboard_worker.start()
        return _dashboard_worker


def stop_dashboard_snapshot_worker() -> None:
    global _dashboard_worker
    _dashboard_worker_stop.set()
    with _dashboard_lock:
        worker = _dashboard_worker
    if worker is not None and worker is not threading.current_thread():
        worker.join(timeout=2.0)
    with _dashboard_lock:
        _dashboard_worker = None


def request_dashboard_refresh() -> None:
    with _dashboard_snapshot_lock:
        snapshot = _dashboard_snapshot
    if snapshot is not None:
        _request_refresh(snapshot[0])


@router.get("/dashboard")
def api_dashboard(session: Session = Depends(session_dep)):
    global _dashboard_snapshot
    scope = _DashboardScope(session)
    with _dashboard_snapshot_lock:
        snapshot = _dashboard_snapshot
    if snapshot is None or snapshot[0] != scope:
        persisted = _read_persisted_snapshot(scope)
        if persisted is not None:
            with _dashboard_snapshot_lock:
                _dashboard_snapshot = (scope, persisted[0], persisted[1])
            snapshot = _dashboard_snapshot
    if snapshot is None or snapshot[0] != scope:
        _request_refresh(scope)
        start_dashboard_snapshot_worker()
        return {"snapshot": _snapshot_metadata("pending", None, scope, True)}
    age = time.monotonic() - snapshot[1]
    if age >= _DASHBOARD_SNAPSHOT_TTL_SECONDS:
        _request_refresh(scope)
        start_dashboard_snapshot_worker()
    payload = dict(snapshot[2])
    metadata = dict(payload.get("snapshot") or {})
    metadata["status"] = "stale" if age >= _DASHBOARD_SNAPSHOT_TTL_SECONDS else "ready"
    metadata["refresh_pending"] = _dashboard_refreshing or _dashboard_refresh_requested.is_set()
    payload["snapshot"] = metadata
    return payload


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
