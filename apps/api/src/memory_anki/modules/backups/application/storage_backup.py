from __future__ import annotations

import json
import logging
import shutil
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

from memory_anki.core.config import (
    APP_HOME,
    BACKUPS_DIR,
    DB_PATH,
    STORAGE_ROOT_CACHE,
    STORAGE_ROOT_LEARNING,
    ensure_runtime_dirs,
)
from memory_anki.core.runtime import build_runtime_info
from memory_anki.core.runtime_storage_lock import storage_write_lock
from memory_anki.core.storage_layout import (
    ManagedStorageItem,
    get_backup_storage_items,
    load_storage_layout,
    validate_relative_storage_path,
)
from memory_anki.infrastructure.db.maintenance import (
    DatabaseMaintenanceError,
    checkpoint_sqlite_wal,
)

logger = logging.getLogger(__name__)

BACKUP_MANIFEST_NAME = "manifest.json"
BACKUP_MANIFEST_VERSION = 3

# 滚动（轻量）备份时只复制的存储项 key，避免把大媒体目录反复整库复制。
ROLLING_BACKUP_ITEM_KEYS = ("database", "migration_state")
RESCUE_BACKUP_ITEM_KEYS = ("database", "time_ledger", "attachments", "migration_state")


def _database_sidecar_paths(path: Path) -> tuple[Path, Path]:
    return (
        path.with_name(f"{path.name}-wal"),
        path.with_name(f"{path.name}-shm"),
    )


def _database_backup_info() -> dict[str, Any]:
    sidecars = []
    for sidecar in _database_sidecar_paths(DB_PATH):
        sidecars.append(
            {
                "name": sidecar.name,
                "relative_path": sidecar.relative_to(APP_HOME).as_posix()
                if sidecar.is_relative_to(APP_HOME)
                else sidecar.name,
                "exists": sidecar.exists(),
                "size_bytes": sidecar.stat().st_size if sidecar.exists() else 0,
            }
        )
    return {
        "relative_path": DB_PATH.relative_to(APP_HOME).as_posix()
        if DB_PATH.is_relative_to(APP_HOME)
        else DB_PATH.name,
        "exists": DB_PATH.exists(),
        "size_bytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0,
        "sidecars": sidecars,
    }


# One backup() of every page holds a source read transaction for the whole
# copy. On this product's ~200 MB database that is minutes, and wrapping it in
# the study lock made every progress save wait 15s and return 503. Small steps
# release that read lock between batches so writers and WAL checkpoints proceed.
_ONLINE_BACKUP_PAGES = 128
_ONLINE_BACKUP_SLEEP_SECONDS = 0.01


def _sqlite_online_backup(source: Path, target: Path) -> bool:
    """Snapshot a healthy database. Return False when only raw bytes were copied.

    A consistent online backup already includes WAL frames, so callers must not
    attach the live sidecars. A corrupt source cannot be snapshotted; copy the
    main file and let the caller keep its sidecars for rescue.

    The online path does not take the study lock. SQLite's backup API already
    copies committed pages while other connections write. Only the rare raw
    fallback, which can tear a live file, takes the lock, and only for that copy.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        raise FileNotFoundError(source)
    source_conn = None
    target_conn = None
    try:
        source_conn = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
        target_conn = sqlite3.connect(str(target))
        source_conn.backup(
            target_conn,
            pages=_ONLINE_BACKUP_PAGES,
            sleep=_ONLINE_BACKUP_SLEEP_SECONDS,
        )
        result = target_conn.execute("PRAGMA quick_check").fetchone()
        if result != ("ok",):
            raise sqlite3.DatabaseError(f"invalid SQLite snapshot: {result}")
        return True
    except sqlite3.DatabaseError:
        if target_conn is not None:
            target_conn.close()
            target_conn = None
        if source_conn is not None:
            source_conn.close()
            source_conn = None
        if target.exists():
            target.unlink()
        with storage_write_lock(APP_HOME):
            shutil.copy2(source, target)
        return False
    finally:
        if target_conn is not None:
            target_conn.close()
        if source_conn is not None:
            source_conn.close()


def _copy_item_to_backup(item: ManagedStorageItem, destination_root: Path) -> dict[str, Any]:
    source = item.absolute_path(APP_HOME)
    target = destination_root / item.relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    exists = source.exists()
    sidecar_entries: list[dict[str, Any]] = []

    if exists:
        if item.kind == "directory":
            shutil.copytree(source, target, dirs_exist_ok=True, ignore=_ignore_nested_backups)
        elif item.key == "database":
            # Read sidecars before opening SQLite. A failed snapshot can rewrite
            # the live -shm, and a rescue must keep the bytes that existed first.
            sidecar_payloads = [
                (sidecar, sidecar.read_bytes() if sidecar.is_file() else None)
                for sidecar in _database_sidecar_paths(source)
            ]
            consistent = _sqlite_online_backup(source, target)
            for sidecar, payload in sidecar_payloads:
                sidecar_target = target.with_name(sidecar.name)
                include_sidecar = payload is not None and not consistent
                if payload is not None and not consistent:
                    sidecar_target.write_bytes(payload)
                elif sidecar_target.exists():
                    sidecar_target.unlink()
                sidecar_entries.append(
                    {
                        "name": sidecar.name,
                        "relative_path": sidecar_target.relative_to(destination_root).as_posix(),
                        "source_exists": payload is not None,
                        "included": include_sidecar,
                        "size_bytes": len(payload) if payload is not None else 0,
                        "reason": None if include_sidecar else "sqlite_online_backup_excludes_wal_shm",
                    }
                )
        else:
            shutil.copy2(source, target)
    elif item.kind == "directory" and item.required:
        target.mkdir(parents=True, exist_ok=True)

    return {
        "key": item.key,
        "relative_path": item.relative_path,
        "kind": item.kind,
        "required": item.required,
        "source_exists": exists,
        "included": exists or (item.kind == "directory" and item.required),
        "sidecars": sidecar_entries,
    }


def _ignore_nested_backups(current_dir: str, names: list[str]) -> set[str]:
    current_path = Path(current_dir).resolve()
    backups_path = BACKUPS_DIR.resolve()
    if current_path.name == backups_path.name:
        return set(names)
    if current_path == backups_path.parent and backups_path.name in names:
        return {backups_path.name}
    if current_path.name in {"data", STORAGE_ROOT_CACHE, STORAGE_ROOT_LEARNING} and backups_path.name in names:
        return {backups_path.name}
    return set()


def _select_backup_items(*, full: bool, scope: str | None = None) -> list[ManagedStorageItem]:
    """Select the explicitly documented backup scope."""
    all_items = get_backup_storage_items()
    if full or scope == "full":
        return list(all_items)
    keys = RESCUE_BACKUP_ITEM_KEYS if scope == "rescue" else ROLLING_BACKUP_ITEM_KEYS
    return [item for item in all_items if item.key in set(keys)]


def create_storage_backup_manifest(
    *, reason: str, included_items: list[dict[str, Any]], full: bool
) -> dict[str, Any]:
    runtime_info = build_runtime_info()
    return {
        "version": BACKUP_MANIFEST_VERSION,
        "reason": reason,
        "scope": "full" if full else "rolling",
        "full": full,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "storage_mode": load_storage_layout().storage_mode,
        "app_home": str(APP_HOME),
        "database": _database_backup_info(),
        "runtime_info": {
            "channel": runtime_info.get("channel"),
            "commit": runtime_info.get("commit"),
            "min_supported_generation": runtime_info.get("min_supported_generation"),
            "max_supported_generation": runtime_info.get("max_supported_generation"),
        },
        "included_items": included_items,
    }


def _snapshot_databases(stage: Path, items: list[ManagedStorageItem]) -> dict[str, dict[str, Any]]:
    """Capture a consistent database snapshot without the study lock.

    SQLite's online backup API copies committed pages and yields between steps,
    so writers keep committing. The previous wrapper held ``storage_write_lock``
    for the whole copy. On a ~200 MB database sitting on a synced drive that
    lasted minutes, and every study write waited 15s then returned 503.
    """
    captured: dict[str, dict[str, Any]] = {}
    for item in items:
        if item.key == "database":
            captured[item.key] = _copy_item_to_backup(item, stage)
    return captured


def write_storage_backup(
    destination_root: Path, *, reason: str, full: bool = True, scope: str | None = None
) -> dict[str, Any]:
    ensure_runtime_dirs()
    # The copy below is an online backup, so it is already consistent. A
    # TRUNCATE checkpoint here used to run outside the study lock and freeze
    # every rating for as long as the synced database took to reset its log.
    # PASSIVE never waits on a reader, and a busy log must not fail the backup.
    try:
        checkpoint_sqlite_wal(mode="PASSIVE")
    except DatabaseMaintenanceError:
        logger.warning("Skipping WAL checkpoint; online backup does not need it", exc_info=True)
    destination_root = Path(destination_root)
    items = _select_backup_items(full=full, scope=scope)
    if destination_root.exists() and any(destination_root.iterdir()):
        raise FileExistsError(f"backup destination is not empty: {destination_root}")
    destination_root.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".backup-stage-", dir=destination_root.parent) as stage_dir:
        stage = Path(stage_dir)
        # Phase 1: consistent database snapshot. Online backup does not take the
        # study lock, so a progress save can commit while the copy is still running.
        captured = _snapshot_databases(stage, items)
        # Phase 2: copy remaining files/media, also without the study lock.
        included_items = [
            captured[item.key] if item.key in captured else _copy_item_to_backup(item, stage)
            for item in items
        ]
        manifest = create_storage_backup_manifest(
            reason=reason, included_items=included_items, full=full
        )
        manifest["scope"] = scope or ("full" if full else "rolling")
        manifest["database_snapshot"] = "sqlite_online_backup"
        manifest["excluded_items"] = [
            item.key for item in get_backup_storage_items()
            if item.key not in {entry["key"] for entry in included_items}
        ]
        (stage / BACKUP_MANIFEST_NAME).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        destination_root.mkdir(parents=True, exist_ok=True)
        for child in stage.iterdir():
            child.replace(destination_root / child.name)
    return manifest


def read_storage_backup_manifest(backup_root: Path) -> dict[str, Any]:
    manifest_path = backup_root / BACKUP_MANIFEST_NAME
    if not manifest_path.exists():
        return {}
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def restore_storage_backup(backup_root: Path) -> list[str]:
    ensure_runtime_dirs()
    backup_root = Path(backup_root).resolve()
    with storage_write_lock(APP_HOME):
        manifest = read_storage_backup_manifest(backup_root)
        manifest_items = manifest.get("included_items")
        if not isinstance(manifest_items, list):
            raise ValueError("backup manifest has no included_items")
        managed = {item.key: item for item in get_backup_storage_items()}
        home = Path(APP_HOME).resolve()
        plan: list[tuple[str, str, Path, Path]] = []
        for raw in manifest_items:
            if not isinstance(raw, dict) or not raw.get("included"):
                continue
            key = str(raw.get("key") or "")
            if key not in managed:
                raise ValueError(f"backup contains unmanaged key: {key!r}")
            relative_path = validate_relative_storage_path(str(raw.get("relative_path") or ""))
            if relative_path != managed[key].relative_path:
                raise ValueError(f"manifest path does not match managed key: {key}")
            source = (backup_root / relative_path).resolve()
            if source != backup_root and backup_root not in source.parents:
                raise ValueError("backup path escapes backup root")
            if not source.exists():
                raise FileNotFoundError(source)
            destination = (home / relative_path).resolve()
            if destination != home and home not in destination.parents:
                raise ValueError("managed path escapes app home")
            plan.append((key, managed[key].kind, source, destination))
            if key != "database":
                continue
            db_name = Path(relative_path).name
            allowed_sidecars = {f"{db_name}-wal", f"{db_name}-shm"}
            for sidecar in raw.get("sidecars") or []:
                if not isinstance(sidecar, dict) or not sidecar.get("included"):
                    continue
                sidecar_relative = validate_relative_storage_path(str(sidecar.get("relative_path") or ""))
                if PurePosixPath(sidecar_relative).name not in allowed_sidecars:
                    raise ValueError("unexpected database sidecar")
                sidecar_source = (backup_root / sidecar_relative).resolve()
                if sidecar_source != backup_root and backup_root not in sidecar_source.parents:
                    raise ValueError("backup path escapes backup root")
                if not sidecar_source.is_file():
                    raise FileNotFoundError(sidecar_source)
                sidecar_destination = destination.with_name(sidecar_source.name).resolve()
                if home not in sidecar_destination.parents:
                    raise ValueError("managed path escapes app home")
                plan.append((f"{key}:sidecar", "file", sidecar_source, sidecar_destination))
        # Preflight all entries before replacing any live data.
        for _, kind, source, _ in plan:
            if kind == "directory" and not source.is_dir():
                raise ValueError(f"expected directory in backup: {source}")
            if kind == "file" and not source.is_file():
                raise ValueError(f"expected file in backup: {source}")
        staged: list[tuple[Path, Path]] = []
        swapped: list[tuple[Path, Path | None]] = []
        try:
            for key, kind, source, destination in plan:
                destination.parent.mkdir(parents=True, exist_ok=True)
                stage_name = key.replace(":", "-")
                stage = Path(tempfile.mkdtemp(prefix=f"restore-{stage_name}-", dir=destination.parent))
                staged_copy = stage / destination.name
                if kind == "directory":
                    shutil.copytree(source, staged_copy)
                else:
                    shutil.copy2(source, staged_copy)
                staged.append((destination, stage))
            for destination, stage in staged:
                old = destination.with_name(f".{destination.name}.restore-old")
                if destination.exists():
                    if old.exists():
                        shutil.rmtree(old) if old.is_dir() else old.unlink()
                    destination.replace(old)
                    swapped.append((destination, old))
                (stage / destination.name).replace(destination)
            for _, previous in swapped:
                if previous is not None and previous.exists():
                    shutil.rmtree(previous) if previous.is_dir() else previous.unlink()
            return [key for key, _, _, _ in plan if not key.endswith(":sidecar")]
        except Exception:
            for restored, previous in reversed(swapped):
                if restored.exists():
                    shutil.rmtree(restored) if restored.is_dir() else restored.unlink()
                if previous is not None and previous.exists():
                    previous.replace(restored)
            raise
        finally:
            for _, stage in staged:
                shutil.rmtree(stage, ignore_errors=True)
