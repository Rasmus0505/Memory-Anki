from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory_anki.core.config import APP_HOME, REPO_ROOT
from memory_anki.core.time import iso_utc_now

ACTIVE_RUNTIME_INSTANCES_DIR = APP_HOME / "runtime" / "active-instances"
INSTANCE_HEARTBEAT_INTERVAL_SECONDS = 5.0
INSTANCE_STALE_AFTER_SECONDS = 20.0

_CURRENT_INSTANCE_ID: str | None = None


@dataclass(slots=True)
class RuntimeActivityHandle:
    instance_id: str
    stop_event: threading.Event
    thread: threading.Thread


def _instance_path(instance_id: str) -> Path:
    return ACTIVE_RUNTIME_INSTANCES_DIR / f"{instance_id}.json"


def _read_instance_payload(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _write_instance_payload(instance_id: str, payload: dict[str, Any]) -> None:
    ACTIVE_RUNTIME_INSTANCES_DIR.mkdir(parents=True, exist_ok=True)
    payload = dict(payload)
    payload["instance_id"] = instance_id
    payload["last_seen_at"] = iso_utc_now()
    _instance_path(instance_id).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def current_runtime_instance_id() -> str | None:
    return _CURRENT_INSTANCE_ID


def list_active_runtime_instances() -> list[dict[str, Any]]:
    now = time.time()
    results: list[dict[str, Any]] = []
    ACTIVE_RUNTIME_INSTANCES_DIR.mkdir(parents=True, exist_ok=True)
    for path in ACTIVE_RUNTIME_INSTANCES_DIR.glob("*.json"):
        payload = _read_instance_payload(path)
        if payload is None:
            continue
        age_seconds = max(0.0, now - path.stat().st_mtime)
        if age_seconds > INSTANCE_STALE_AFTER_SECONDS:
            try:
                path.unlink()
            except OSError:
                pass
            continue
        payload["age_seconds"] = round(age_seconds, 3)
        results.append(payload)
    results.sort(key=lambda item: str(item.get("started_at") or ""))
    return results


def describe_active_runtime_instances() -> list[dict[str, Any]]:
    return [
        {
            "instance_id": item.get("instance_id"),
            "pid": item.get("pid"),
            "channel": item.get("channel"),
            "startup_mode": item.get("startup_mode"),
            "workspace": item.get("workspace"),
            "runtime_snapshot": item.get("runtime_snapshot"),
            "started_at": item.get("started_at"),
            "last_seen_at": item.get("last_seen_at"),
            "age_seconds": item.get("age_seconds"),
        }
        for item in list_active_runtime_instances()
    ]


def assert_exclusive_runtime_operation(operation_name: str, *, current_instance_id: str | None = None) -> None:
    active_instances = list_active_runtime_instances()
    if not active_instances:
        return
    foreign_instances = [
        item
        for item in active_instances
        if current_instance_id is None or item.get("instance_id") != current_instance_id
    ]
    if not foreign_instances:
        return
    foreign_labels = ", ".join(
        str(item.get("workspace") or item.get("runtime_snapshot") or item.get("instance_id") or "unknown")
        for item in foreign_instances
    )
    raise RuntimeError(
        f"{operation_name} requires exclusive access to the shared runtime data. "
        f"Close the other running Memory Anki instance(s) first: {foreign_labels}."
    )


def start_runtime_activity_heartbeat(*, channel: str, startup_mode: str) -> RuntimeActivityHandle:
    global _CURRENT_INSTANCE_ID
    instance_id = uuid.uuid4().hex[:12]
    _CURRENT_INSTANCE_ID = instance_id
    payload = {
        "pid": os.getpid(),
        "channel": channel,
        "startup_mode": startup_mode,
        "workspace": str(REPO_ROOT),
        "runtime_snapshot": os.environ.get("MEMORY_ANKI_RUNTIME_SNAPSHOT"),
        "started_at": iso_utc_now(),
        "app_home": str(APP_HOME),
    }
    stop_event = threading.Event()

    def run() -> None:
        while not stop_event.wait(INSTANCE_HEARTBEAT_INTERVAL_SECONDS):
            _write_instance_payload(instance_id, payload)

    _write_instance_payload(instance_id, payload)
    thread = threading.Thread(
        target=run,
        name=f"memory-anki-runtime-activity-{instance_id}",
        daemon=True,
    )
    thread.start()
    return RuntimeActivityHandle(instance_id=instance_id, stop_event=stop_event, thread=thread)


def stop_runtime_activity_heartbeat(handle: RuntimeActivityHandle | None) -> None:
    global _CURRENT_INSTANCE_ID
    if handle is None:
        return
    handle.stop_event.set()
    try:
        handle.thread.join(timeout=2)
    except RuntimeError:
        pass
    try:
        _instance_path(handle.instance_id).unlink()
    except OSError:
        pass
    if _CURRENT_INSTANCE_ID == handle.instance_id:
        _CURRENT_INSTANCE_ID = None
