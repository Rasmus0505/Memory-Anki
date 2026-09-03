"""In-process live study room for PWA and desktop mirroring.

The projection is ephemeral process memory. It must not be written to the
database or the Syncthing data directory.
"""

from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from typing import Any

from memory_anki.core.time import iso_utc_now

LIVE_STUDY_SURFACES = frozenset(
    {
        "idle",
        "freestyle",
        "palace_quiz",
        "mindmap_review",
        "english_course",
        "english_reading",
    }
)
CONTROLLER_DISCONNECT_GRACE_SECONDS = 5.0
SUBSCRIBER_QUEUE_SIZE = 8
OPERATION_CACHE_LIMIT = 64

_lock = threading.RLock()
_projection: dict[str, Any] = {}
_subscribers: dict[str, dict[str, Any]] = {}
_operations: dict[str, dict[str, Any]] = {}
_operation_order: list[str] = []
_controller_grace_until: dict[str, float] = {}


def _empty_projection() -> dict[str, Any]:
    return {
        "revision": 0,
        "controller_client_id": None,
        "route": "",
        "surface": "idle",
        "view": None,
        "timer": None,
        "updated_at": iso_utc_now(),
    }


def reset_live_study_room() -> None:
    """Test helper: drop subscribers and restore an empty projection."""

    with _lock:
        for item in _subscribers.values():
            inbox: queue.Queue[dict[str, Any] | None] = item["queue"]
            try:
                inbox.put_nowait(None)
            except queue.Full:
                pass
        _subscribers.clear()
        _operations.clear()
        _operation_order.clear()
        _controller_grace_until.clear()
        _projection.clear()
        _projection.update(_empty_projection())


reset_live_study_room()


def get_live_study_projection() -> dict[str, Any]:
    with _lock:
        return dict(_projection)


def encode_live_sse(event: str, payload: dict[str, Any]) -> str:
    return (
        f"event: {event}\n"
        f"data: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"
    )


def _copy_projection() -> dict[str, Any]:
    return json.loads(json.dumps(_projection, ensure_ascii=False))


def _remember_operation(operation_id: str, response: dict[str, Any]) -> None:
    if operation_id in _operations:
        _operations[operation_id] = response
        return
    _operations[operation_id] = response
    _operation_order.append(operation_id)
    overflow = len(_operation_order) - OPERATION_CACHE_LIMIT
    if overflow <= 0:
        return
    for stale_id in _operation_order[:overflow]:
        _operations.pop(stale_id, None)
    del _operation_order[:overflow]


def _emit_locked(event: str, publisher_client_id: str | None) -> None:
    payload = {
        "publisher_client_id": publisher_client_id,
        "projection": _copy_projection(),
    }
    message = {"event": event, "data": payload}
    for item in list(_subscribers.values()):
        inbox: queue.Queue[dict[str, Any] | None] = item["queue"]
        if inbox.full():
            try:
                inbox.get_nowait()
            except queue.Empty:
                pass
        try:
            inbox.put_nowait(message)
        except queue.Full:
            pass


def _pause_timer_locked() -> bool:
    timer = _projection.get("timer")
    if not isinstance(timer, dict):
        return False
    status = str(timer.get("status") or "")
    semantic = str(timer.get("semanticState") or timer.get("semantic_state") or "")
    if status != "running" and semantic != "running":
        return False
    paused = dict(timer)
    paused["status"] = "paused"
    paused["semanticState"] = "paused"
    paused["progressMode"] = "frozen"
    paused["updatedAt"] = int(time.time() * 1000)
    _projection["timer"] = paused
    _projection["updated_at"] = iso_utc_now()
    return True


def expire_disconnected_controllers(now: float | None = None) -> None:
    moment = time.monotonic() if now is None else now
    with _lock:
        connected = {str(item["client_id"]) for item in _subscribers.values()}
        expired: list[str] = []
        for client_id, deadline in list(_controller_grace_until.items()):
            if client_id in connected:
                _controller_grace_until.pop(client_id, None)
                continue
            if moment < deadline:
                continue
            expired.append(client_id)
            _controller_grace_until.pop(client_id, None)
        if not expired:
            return
        controller = _projection.get("controller_client_id")
        if controller not in expired:
            return
        _pause_timer_locked()
        _projection["controller_client_id"] = None
        _projection["revision"] = int(_projection.get("revision") or 0) + 1
        _projection["updated_at"] = iso_utc_now()
        _emit_locked("update", None)


def subscribe_live_study(client_id: str, subscriber_id: str | None = None) -> tuple[str, queue.Queue[dict[str, Any] | None]]:
    identity = (subscriber_id or "").strip() or f"{client_id}:{uuid.uuid4()}"
    inbox: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
    with _lock:
        _subscribers[identity] = {"client_id": client_id, "queue": inbox}
        _controller_grace_until.pop(client_id, None)
    return identity, inbox


def unsubscribe_live_study(subscriber_id: str) -> None:
    with _lock:
        item = _subscribers.pop(subscriber_id, None)
        if item is None:
            return
        client_id = str(item["client_id"])
        still_connected = any(entry["client_id"] == client_id for entry in _subscribers.values())
        if still_connected:
            return
        if _projection.get("controller_client_id") == client_id:
            _controller_grace_until[client_id] = (
                time.monotonic() + CONTROLLER_DISCONNECT_GRACE_SECONDS
            )


def stream_live_study_events(client_id: str):
    subscriber_id, inbox = subscribe_live_study(client_id)
    try:
        yield encode_live_sse(
            "snapshot",
            {"publisher_client_id": None, "projection": get_live_study_projection()},
        )
        while True:
            try:
                item = inbox.get(timeout=15.0)
            except queue.Empty:
                expire_disconnected_controllers()
                yield ": ping\n\n"
                continue
            if item is None:
                break
            yield encode_live_sse(str(item["event"]), item["data"])
    finally:
        unsubscribe_live_study(subscriber_id)


def _normalize_surface(value: Any) -> str | None:
    if value is None:
        return None
    surface = str(value).strip()
    if not surface:
        return None
    if surface not in LIVE_STUDY_SURFACES:
        raise ValueError(f"unsupported live study surface: {surface}")
    return surface


def _timer_changed(current: Any, incoming: Any) -> bool:
    return json.dumps(current, sort_keys=True, default=str) != json.dumps(
        incoming, sort_keys=True, default=str
    )


def apply_live_study_command(payload: dict[str, Any]) -> dict[str, Any]:
    command_type = str(payload.get("type") or "publish").strip() or "publish"
    client_id = str(payload.get("client_id") or "").strip()
    operation_id = str(payload.get("operation_id") or "").strip()
    if not client_id:
        raise ValueError("client_id is required")
    if not operation_id:
        raise ValueError("operation_id is required")
    if command_type not in {"publish", "hello"}:
        raise ValueError(f"unsupported live study command: {command_type}")

    expire_disconnected_controllers()

    with _lock:
        cached = _operations.get(operation_id)
        if cached is not None:
            return dict(cached)

        if command_type == "hello":
            response = {
                "accepted": True,
                "duplicate": False,
                "projection": _copy_projection(),
            }
            _remember_operation(operation_id, response)
            return dict(response)

        take_control = bool(payload.get("take_control"))
        has_route = "route" in payload and payload.get("route") is not None
        has_surface = "surface" in payload and payload.get("surface") is not None
        has_view = "view" in payload
        has_timer = "timer" in payload
        surface = _normalize_surface(payload.get("surface")) if has_surface else None
        route = str(payload.get("route") or "") if has_route else None
        becomes_controller = take_control or has_route or has_surface or has_view
        is_controller = _projection.get("controller_client_id") == client_id
        accept_timer = has_timer and (
            becomes_controller or is_controller or _projection.get("controller_client_id") is None
        )

        changed = False
        if becomes_controller and _projection.get("controller_client_id") != client_id:
            _projection["controller_client_id"] = client_id
            changed = True
        if route is not None and _projection.get("route") != route:
            _projection["route"] = route
            changed = True
        if surface is not None and _projection.get("surface") != surface:
            _projection["surface"] = surface
            changed = True
        if has_view:
            incoming_view = payload.get("view")
            if _timer_changed(_projection.get("view"), incoming_view):
                _projection["view"] = incoming_view
                changed = True
        if accept_timer:
            incoming_timer = payload.get("timer")
            if _timer_changed(_projection.get("timer"), incoming_timer):
                _projection["timer"] = incoming_timer
                changed = True

        if changed:
            _projection["revision"] = int(_projection.get("revision") or 0) + 1
            _projection["updated_at"] = iso_utc_now()
            _emit_locked("update", client_id)

        response = {
            "accepted": True,
            "duplicate": False,
            "projection": _copy_projection(),
        }
        _remember_operation(operation_id, response)
        return dict(response)
