"""Immutable UTC interval files: deterministic replace and terminal tombstones."""
from __future__ import annotations

import json
import os
import tempfile
import threading
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


# Folding the ledger re-reads every immutable revision and re-validates every
# interval. On the owner's USB volume that is ~2,700 small JSON files and costs
# about 20s cold, or about 1s once the OS cache is warm. The dashboard used to
# do that four times per request, and a 20s client timeout then retried, so the
# folds stacked on the GIL and every retry got slower. Cache the folded rows
# for this process, and let concurrent readers wait for the one fold already
# in flight instead of starting another.
_CACHE_GUARD = threading.Lock()
_FOLDED_CACHE: dict[str, tuple[tuple[Any, ...], list[dict[str, Any]]]] = {}
_FOLD_EVENTS: dict[str, threading.Event] = {}
_GENERATION: dict[str, int] = {}
_SNAPSHOT_NAME = "_folded_cache.json"
# v1: rows keyed by directory mtime signature (cannot be extended safely).
# v2: rows plus the reducer state and the exact revision files they cover.
_SNAPSHOT_SCHEMA_VERSION = 2
_SNAPSHOT_SCHEMA_VERSIONS = (1, 2)


def _root_key(app_home: Path | None) -> tuple[Path, str]:
    root = ledger_root(app_home).resolve()
    return root, str(root)


def _revision_signature(root: Path) -> tuple[tuple[str, str, int, int], ...]:
    """Inventory revision files, including files copied with an old mtime.

    Directory mtimes are not a reliable sync boundary: Syncthing can copy a
    revision whose timestamp predates the directory's current mtime.  The
    filename is the stable revision identity; size and mtime detect replacement
    or corruption of an existing file and force a full fold.
    """
    devices_dir = root / "devices"
    if not devices_dir.is_dir():
        return ()
    found: list[tuple[str, str, int, int]] = []
    try:
        device_dirs = list(devices_dir.iterdir())
    except OSError:
        return ()
    for device_dir in device_dirs:
        revisions = device_dir / "revisions"
        if not revisions.is_dir():
            continue
        try:
            paths = list(revisions.glob("*.json"))
        except OSError:
            continue
        for path in paths:
            try:
                stat = path.stat()
            except OSError:
                continue
            found.append((device_dir.name, path.name, stat.st_size, stat.st_mtime_ns))
    found.sort()
    return tuple(found)


def _cache_token(root: Path, key: str) -> tuple[Any, ...]:
    with _CACHE_GUARD:
        generation = _GENERATION.get(key, 0)
    return (_revision_signature(root), generation)


def _invalidate_ledger_cache(app_home: Path | None) -> None:
    _root, key = _root_key(app_home)
    with _CACHE_GUARD:
        _GENERATION[key] = _GENERATION.get(key, 0) + 1
        _FOLDED_CACHE.pop(key, None)


def _copy_visible(rows: list[dict[str, Any]], *, include_deleted: bool) -> list[dict[str, Any]]:
    if include_deleted:
        return [dict(row) for row in rows]
    return [dict(row) for row in rows if not row.get("deleted")]


def _snapshot_path(root: Path) -> Path:
    return root / _SNAPSHOT_NAME


def _snapshot_rows(payload: dict[str, Any]) -> list[dict[str, Any]] | None:
    rows = payload.get("rows")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        return None
    return rows


def _snapshot_covers(payload: dict[str, Any]) -> tuple[bool, tuple[tuple[str, str, int, int], ...]]:
    """Rows plus their covered revision set.

    Schema 1 stored a per-directory mtime signature and plain rows. Schema 2
    stores one entry per revision file, which is what makes an incremental
    append detectable. Only schema 2 also carries the reducer state that group
    replacements and tombstones live in, so only schema 2 may be extended by
    folding new files. A legacy snapshot is still usable as rows, but its
    history must never be reopened, because dropping `deleted` /
    `group_operations` would resurrect intervals the user deleted.
    """
    rows = _snapshot_rows(payload)
    if rows is None:
        return False, ()
    version = payload.get("schema_version")
    if version == 1:
        return False, ()
    stored = payload.get("revision_files")
    if not isinstance(stored, list) or payload.get("state") is None:
        return False, ()
    signature: list[tuple[str, str, int, int]] = []
    for item in stored:
        if (not isinstance(item, list) or len(item) != 4 or not isinstance(item[0], str)
                or not isinstance(item[1], str) or not isinstance(item[2], int) or not isinstance(item[3], int)):
            return False, ()
        signature.append((item[0], item[1], item[2], item[3]))
    return True, tuple(signature)


def _read_snapshot_payload(root: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(_snapshot_path(root).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or payload.get("schema_version") not in _SNAPSHOT_SCHEMA_VERSIONS:
        return None
    return payload


def _snapshot_state(payload: dict[str, Any]) -> dict[str, Any] | None:
    state = payload.get("state")
    return state if isinstance(state, dict) else None


def _load_any_snapshot(root: Path) -> dict[str, Any] | None:
    payload = _read_snapshot_payload(root)
    if payload is None or _snapshot_rows(payload) is None:
        return None
    complete, signature = _snapshot_covers(payload)
    return {"payload": payload, "rows": _snapshot_rows(payload), "complete": complete,
            "signature": signature, "state": _snapshot_state(payload)}


def _write_snapshot(root: Path, signature: tuple[tuple[str, str, int, int], ...], snapshot: dict[str, Any]) -> None:
    state = snapshot.get("state")
    if not isinstance(state, dict):
        # Without reducer state an incremental fold would drop tombstones and
        # group replacements, so such a snapshot is only ever a row cache.
        return
    try:
        _atomic_json_write(
            _snapshot_path(root),
            {
                "schema_version": _SNAPSHOT_SCHEMA_VERSION,
                "revision_files": [list(item) for item in signature],
                "rows": snapshot["rows"],
                "state": state,
            },
        )
    except (OSError, TypeError, ValueError):
        return


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
    _invalidate_ledger_cache(home)
    return {"revision_id": revision, "device_id": device, "interval_count": len(items)}


def append_revision(upload: TimeLedgerUpload, *, app_home: Path | None = None, device_id: str | None = None) -> dict[str, Any]:
    items = [item.normalized().model_dump(mode="json") for item in upload.intervals]
    return _append(items, [], app_home=app_home, device_id=device_id)


_REFRESHING: set[str] = set()
_MAX_INCREMENTAL_FILES = 64


def _store_folded(root: Path, key: str, token: tuple[Any, ...], snapshot: dict[str, Any], *, persist: bool) -> None:
    """Cache and optionally persist a fold result.

    `snapshot` is `{"rows": [...], "state": {...}}`; `state` is required for
    `persist=True` because a snapshot without reducer state can only ever serve
    rows, never receive an incremental append.
    """
    signature_now = _revision_signature(root)
    stored = False
    with _CACHE_GUARD:
        # Lock is not re-entrant; do not call _cache_token while holding it.
        if (signature_now, _GENERATION.get(key, 0)) != token:
            return
        _FOLDED_CACHE[key] = (token, snapshot)
        stored = True
    if persist and stored:
        _write_snapshot(root, signature_now, snapshot)


def _files_newer_than(root: Path, signature: tuple[tuple[str, str, int, int], ...]) -> list[Path] | None:
    """Return revision files the snapshot does not cover, or None if unsure.

    Only additions are incremental: a file whose size or mtime differs from the
    snapshot's record of it, or a revision the snapshot listed but that is now
    gone, means the history was rewritten and must be folded from scratch.
    """
    known = {(device, name): (size, mtime) for device, name, size, mtime in signature}
    seen: set[tuple[str, str]] = set()
    files: list[Path] = []
    devices_dir = root / "devices"
    if not devices_dir.is_dir():
        return None if signature else []
    try:
        device_dirs = list(devices_dir.iterdir())
    except OSError:
        return None
    for device_dir in device_dirs:
        revisions = device_dir / "revisions"
        if not revisions.is_dir():
            continue
        try:
            candidates = list(revisions.glob("*.json"))
        except OSError:
            return None
        for path in candidates:
            identity = (device_dir.name, path.name)
            seen.add(identity)
            try:
                stat = path.stat()
            except OSError:
                return None
            previous = known.get(identity)
            if previous is None:
                files.append(path)
            elif previous != (stat.st_size, stat.st_mtime_ns):
                return None
    if set(known) - seen:
        return None
    return files


def _schedule_full_refresh(root: Path, key: str) -> None:
    with _CACHE_GUARD:
        if key in _REFRESHING:
            return
        _REFRESHING.add(key)

    def refresh() -> None:
        try:
            token = _cache_token(root, key)
            _store_folded(root, key, token, _fold_intervals(root), persist=True)
        except Exception:
            return
        finally:
            with _CACHE_GUARD:
                _REFRESHING.discard(key)

    threading.Thread(target=refresh, name="memory-anki-ledger-refresh", daemon=True).start()


def read_intervals(*, app_home: Path | None = None, include_deleted: bool = False) -> list[dict[str, Any]]:
    root, key = _root_key(app_home)
    token = _cache_token(root, key)
    with _CACHE_GUARD:
        cached = _FOLDED_CACHE.get(key)
        if cached is not None and cached[0] == token:
            return _copy_visible(cached[1]["rows"], include_deleted=include_deleted)
    snapshot = _load_any_snapshot(root)
    if snapshot is not None:
        rows = snapshot["rows"]
        if snapshot["complete"] and snapshot["signature"] == token[0]:
            _store_folded(root, key, token, snapshot, persist=False)
            return _copy_visible(rows, include_deleted=include_deleted)
        if snapshot["complete"]:
            newer = _files_newer_than(root, snapshot["signature"])
            if newer is not None and len(newer) <= _MAX_INCREMENTAL_FILES:
                # A new revision must not replay every historical file. That
                # replay is ~45s on the USB volume and blows the 20s timeout.
                folded = _fold_paths(sorted(newer), base_state=snapshot["state"])
                _store_folded(root, key, token, folded, persist=True)
                return _copy_visible(folded["rows"], include_deleted=include_deleted)
        # Legacy snapshot, or history rewritten: serve what we have now and
        # refold in the background instead of blocking the request.
        _schedule_full_refresh(root, key)
        return _copy_visible(rows, include_deleted=include_deleted)
    folded = _fold_intervals(root)
    _store_folded(root, key, token, folded, persist=True)
    return _copy_visible(folded["rows"], include_deleted=include_deleted)


def _fold_intervals(root: Path) -> dict[str, Any]:
    return _fold_snapshot(sorted(root.glob("devices/*/revisions/*.json")))


def _fold_paths(paths: list[Path], base_rows: list[dict[str, Any]] | None = None,
                base_state: dict[str, Any] | None = None) -> dict[str, Any]:
    return _fold_snapshot(paths, base_rows=base_rows, base_state=base_state)


def _fold_snapshot(paths: list[Path], base_rows: list[dict[str, Any]] | None = None,
                   base_state: dict[str, Any] | None = None) -> dict[str, Any]:
    rows, state = _fold_state(paths, base_rows=base_rows, base_state=base_state)
    return {"rows": rows, "state": state}


def _fold_state(paths: list[Path], base_rows: list[dict[str, Any]] | None = None,
                base_state: dict[str, Any] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_id: dict[str, tuple[tuple[str, str], dict[str, Any]]] = {}
    deleted: set[str] = set()
    group_operations: dict[str, tuple[tuple[str, str], str, dict[str, Any] | None]] = {}
    if base_state:
        for key, value in base_state.get("by_id", {}).items():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], list) and isinstance(value[1], dict):
                order = tuple(value[0])
                if len(order) == 2 and all(isinstance(item, str) for item in order):
                    by_id[key] = (order, dict(value[1]))
        deleted = {item for item in base_state.get("deleted", []) if isinstance(item, str)}
        for group, value in base_state.get("group_operations", {}).items():
            if isinstance(value, list) and len(value) == 3 and isinstance(value[0], list) and isinstance(value[1], str):
                order = tuple(value[0])
                if len(order) == 2 and all(isinstance(item, str) for item in order):
                    group_operations[group] = (order, value[1], value[2] if isinstance(value[2], dict) else None)
    else:
        for row in base_rows or []:
            interval_id = row.get("interval_id")
            if not isinstance(interval_id, str) or not interval_id:
                continue
            item = {key: value for key, value in row.items() if key != "deleted"}
            by_id[interval_id] = (("", ""), item)
            if row.get("deleted"):
                deleted.add(interval_id)
    for path in paths:
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
    rows = [{**item, "deleted": key in suppressed} for key, (_, item) in sorted(by_id.items())]
    # The tombstone and group-operation history is not recoverable from `rows`
    # alone, so it travels with them: a later incremental fold that inherited
    # only rows would resurrect every interval the user deleted.
    state = {
        "by_id": {key: [list(order), item] for key, (order, item) in by_id.items()},
        "deleted": sorted(suppressed),
        "group_operations": {group: [list(order), operation, replacement]
                             for group, (order, operation, replacement) in group_operations.items()},
    }
    return rows, state


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
