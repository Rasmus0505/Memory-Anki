"""Immutable UTC interval files: deterministic replace and terminal tombstones."""
from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from memory_anki.core.local_config import load_local_runtime_config
from memory_anki.core.runtime_paths import resolve_app_home
from memory_anki.modules.session.domain.time_ledger import TimeLedgerInterval, TimeLedgerUpload


def _default_ledger_home() -> Path:
    """Follow MEMORY_ANKI_HOME when set so tests never read the live ledger.

    An unset home still uses local-config, which is where a manually placed
    data directory lives when the process was not launched with the env var.
    """
    resolution = resolve_app_home()
    if resolution.source == "env":
        return resolution.app_home
    return load_local_runtime_config().local_app_home


def ledger_root(app_home: Path | None = None) -> Path:
    return Path(app_home or _default_ledger_home()) / "学习数据" / "time-ledger"


def _atomic_json_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw_path = tempfile.mkstemp(prefix=".ledger-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(raw_path, path)
    finally:
        try:
            os.unlink(raw_path)
        except FileNotFoundError:
            pass


def _group(row: dict[str, Any]) -> str:
    return json.dumps([row["session_id"], row["started_at"]], separators=(",", ":"))


def _append(items: list[dict[str, Any]], tombstones: list[str], *, app_home: Path | None, device_id: str | None, group_operations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    config = load_local_runtime_config() if device_id is None or app_home is None else None
    device = device_id or (config.device_id if config else "")
    if not device or device == "unconfigured" or any(c in device for c in "/\\") or device in {".", ".."}:
        raise ValueError("ledger requires a configured local device_id")
    revision = uuid4().hex
    payload = {"schema_version": 1, "revision_id": revision, "device_id": device,
               "created_at": datetime.now(UTC).isoformat(), "intervals": items, "tombstones": tombstones,
               "group_operations": group_operations or []}
    home = app_home if app_home is not None else _default_ledger_home()
    _atomic_json_write(ledger_root(home) / "devices" / device / "revisions" / f"{revision}.json", payload)
    return {"revision_id": revision, "device_id": device, "interval_count": len(items)}


def append_revision(upload: TimeLedgerUpload, *, app_home: Path | None = None, device_id: str | None = None) -> dict[str, Any]:
    items = [item.normalized().model_dump(mode="json") for item in upload.intervals]
    return _append(items, [], app_home=app_home, device_id=device_id)


def read_intervals(*, app_home: Path | None = None, include_deleted: bool = False) -> list[dict[str, Any]]:
    by_id: dict[str, tuple[tuple[str, str], dict[str, Any]]] = {}
    deleted: set[str] = set()
    group_operations: dict[str, tuple[tuple[str, str], str, dict[str, Any] | None]] = {}
    for path in sorted(ledger_root(app_home).glob("devices/*/revisions/*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or payload.get("schema_version") != 1:
                continue
            created = datetime.fromisoformat(payload["created_at"])
            if created.tzinfo is None or created > datetime.now(UTC):
                continue
            device = payload["device_id"]
            revision = payload["revision_id"]
            if not isinstance(device, str) or not isinstance(revision, str):
                continue
            raw_items = payload.get("intervals", [])
            tombstones = payload.get("tombstones", [])
            if not isinstance(raw_items, list) or not isinstance(tombstones, list):
                continue
            # Validate the entire file before accepting any of its state.
            items = []
            for raw in raw_items:
                if not isinstance(raw, dict):
                    raise ValueError("invalid interval")
                candidate = {k: v for k, v in raw.items() if k != "effective_seconds"}
                interval = TimeLedgerInterval.model_validate(candidate).normalized()
                item = interval.model_dump(mode="json")
                item.update(effective_seconds=interval.effective_seconds, device_id=device, revision_id=revision)
                items.append(item)
            if any(not isinstance(value, str) or not value for value in tombstones):
                continue
            operations = payload.get("group_operations", [])
            if not isinstance(operations, list):
                continue
            validated_operations: list[tuple[str, str, dict[str, Any] | None]] = []
            for operation in operations:
                if not isinstance(operation, dict) or not isinstance(operation.get("group"), str):
                    raise ValueError("invalid group operation")
                group = operation["group"]
                if not group:
                    raise ValueError("invalid group operation")
                if operation.get("deleted") is True and "replacement" not in operation:
                    validated_operations.append((group, "delete", None))
                elif isinstance(operation.get("replacement"), dict) and not operation.get("deleted"):
                    candidate = {key: value for key, value in operation["replacement"].items()
                                 if key in TimeLedgerInterval.model_fields}
                    replacement_interval = TimeLedgerInterval.model_validate(candidate).normalized()
                    replacement = replacement_interval.model_dump(mode="json")
                    replacement.update(device_id=device, revision_id=revision, effective_seconds=replacement_interval.effective_seconds, _origin_group=group)
                    validated_operations.append((group, "replace", replacement))
                else:
                    raise ValueError("invalid group operation")
            # Commit only after every component in this revision has validated.
            order = (created.astimezone(UTC).isoformat(), revision)
            deleted.update(tombstones)
            for group, operation_kind, group_replacement in validated_operations:
                previous = group_operations.get(group)
                if operation_kind == "delete" or previous is None or (previous[1] != "delete" and order > previous[0]):
                    group_operations[group] = (order, operation_kind, group_replacement)
            for item in items:
                key = item["interval_id"]
                if key not in by_id or order > by_id[key][0]:
                    by_id[key] = (order, item)
        except (OSError, UnicodeError, ValueError, TypeError, KeyError, OverflowError):
            continue
    suppressed: set[str] = set(deleted)
    replacements: dict[str, tuple[tuple[str, str], dict[str, Any]]] = {}
    for group, (order, operation, operation_replacement) in group_operations.items():
        suppressed.update(key for key, (_, item) in by_id.items() if _group(item) == group)
        if operation == "replace" and operation_replacement is not None:
            key = str(operation_replacement["interval_id"])
            if key not in replacements or order > replacements[key][0]:
                replacements[key] = (order, operation_replacement)
    for key, (order, replacement) in replacements.items():
        by_id[key] = (order, replacement)
        # Terminal deletion of the identity or current group always wins.
        current_group = group_operations.get(_group(replacement))
        origin_operation = group_operations.get(str(replacement.get("_origin_group") or ""))
        if key not in deleted and not (current_group and current_group[1] == "delete") and not (origin_operation and origin_operation[1] == "delete"):
            suppressed.discard(key)
    return [{**item, "deleted": key in suppressed} for key, (_, item) in sorted(by_id.items())
            if include_deleted or key not in suppressed]


def ledger_item(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata")
    summary = dict(metadata) if isinstance(metadata, dict) else {}
    summary.update(client_source=row.get("client_source", "unknown"), device_id=row.get("device_id"), session_id=row.get("session_id"))
    return {**row, "id": "ledger:" + row["interval_id"], "scene": row["kind"], "status": "completed",
            "summary": summary, "idle_seconds": 0, "pause_count": 0, "events": [], "progress": {}}


def patch_interval(interval_id: str, patch: dict[str, Any], *, app_home: Path | None = None, device_id: str | None = None) -> dict[str, Any] | None:
    row = next((row for row in read_intervals(app_home=app_home) if row["interval_id"] == interval_id), None)
    if row is None:
        return None
    data = {key: row[key] for key in TimeLedgerInterval.model_fields}
    for key in ("title", "started_at", "ended_at", "client_source"):
        if key in patch and patch[key] is not None:
            data[key] = patch[key]
    if patch.get("scene"):
        data["kind"] = patch["scene"]
    if isinstance(patch.get("summary"), dict):
        data["metadata"] = {**data["metadata"], **patch["summary"]}
    interval = TimeLedgerInterval.model_validate(data).normalized()
    if patch.get("effective_seconds") is not None:
        seconds = int(patch["effective_seconds"])
        if seconds < 0:
            raise ValueError("effective_seconds must be nonnegative")
        # A manually edited duration still describes an interval, never an
        # independently additive counter. Anchor its end and move its start.
        interval = interval.model_copy(update={"started_at": interval.ended_at - timedelta(seconds=seconds)})
        interval.metadata["duration_edited"] = True
    group_ids = [candidate["interval_id"] for candidate in read_intervals(app_home=app_home)
                 if candidate.get("session_id") == row.get("session_id")
                 and candidate.get("started_at") == row.get("started_at")
                 and candidate.get("interval_id") != interval_id]
    result = _append(
        [{**interval.model_dump(mode="json"), "effective_seconds": interval.effective_seconds}],
        group_ids,
        app_home=app_home,
        device_id=device_id,
        group_operations=[{"group": _group(row), "replacement": interval.model_dump(mode="json")}],
    )
    return ledger_item({**interval.model_dump(mode="json"), **result, "effective_seconds": interval.effective_seconds})


def delete_intervals(ids: list[str], *, app_home: Path | None = None, device_id: str | None = None) -> int:
    known = [row for row in read_intervals(app_home=app_home) if row["interval_id"] in ids]
    if known:
        groups = {_group(row) for row in known}
        targets = [row["interval_id"] for row in read_intervals(app_home=app_home)
                   if _group(row) in groups]
        _append([], targets, app_home=app_home, device_id=device_id,
                group_operations=[{"group": group, "deleted": True} for group in groups])
        return len(known)
    return 0
