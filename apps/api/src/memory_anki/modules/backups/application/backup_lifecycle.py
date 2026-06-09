from __future__ import annotations

import threading
from datetime import datetime, timedelta
from pathlib import Path

from memory_anki.core.config import DB_PATH, FULL_BACKUPS_DIR, RESCUE_BACKUPS_DIR
from memory_anki.modules.backups.application.storage_backup import (
    read_storage_backup_manifest,
    restore_storage_backup,
    write_storage_backup,
)

AUTO_FULL_BACKUP_INTERVAL = timedelta(hours=4)
ROLLING_EDIT_BACKUP_INTERVAL = timedelta(minutes=30)

_BACKUP_LOCK = threading.Lock()
_BACKUP_LOOP_THREAD: threading.Thread | None = None
_BACKUP_LOOP_STOP = threading.Event()


def timestamp_slug(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return current.strftime("%Y%m%d-%H%M%S")


def create_rescue_snapshot(reason: str) -> Path:
    folder = RESCUE_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
    write_storage_backup(folder, reason=reason)
    return folder


def ensure_daily_backup() -> Path | None:
    if _daily_backup_exists():
        return None
    return create_full_backup("startup")


def create_full_backup(reason: str) -> Path:
    with _BACKUP_LOCK:
        folder = FULL_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        write_storage_backup(folder, reason=reason)
        return folder


def list_backups() -> list[dict]:
    results: list[dict] = []
    for kind, root in (("full", FULL_BACKUPS_DIR), ("rescue", RESCUE_BACKUPS_DIR)):
        if not root.exists():
            continue
        for folder in sorted(root.iterdir(), reverse=True):
            if not folder.is_dir():
                continue
            db_file = folder / DB_PATH.name
            manifest = read_storage_backup_manifest(folder)
            included_items = (
                manifest.get("included_items")
                if isinstance(manifest.get("included_items"), list)
                else []
            )
            included_keys = {
                str(item.get("key"))
                for item in included_items
                if isinstance(item, dict) and item.get("included")
            }
            results.append(
                {
                    "kind": kind,
                    "name": folder.name,
                    "path": str(folder),
                    "created_at": manifest.get("created_at")
                    or datetime.fromtimestamp(folder.stat().st_mtime).isoformat(
                        timespec="seconds"
                    ),
                    "reason": manifest.get("reason") or "",
                    "has_database": db_file.exists(),
                    "has_attachments": "attachments" in included_keys
                    or (folder / "data" / "attachments").exists(),
                    "has_english_data": "english" in included_keys
                    or (folder / "english").exists(),
                    "included_items": sorted(included_keys),
                }
            )
    return results


def restore_database_backup(backup_folder: str) -> Path:
    source_dir = Path(backup_folder)
    source_db = source_dir / DB_PATH.name
    manifest = read_storage_backup_manifest(source_dir)
    if not source_db.exists() and not manifest:
        raise FileNotFoundError("备份中缺少数据库快照。")
    rescue = create_rescue_snapshot("before-db-restore")
    restore_storage_backup(source_dir)
    return rescue


def maybe_create_interval_backup(reason: str, minimum_interval: timedelta) -> Path | None:
    latest = _latest_full_backup()
    if latest and _backup_age(latest) < minimum_interval:
        return None
    return create_full_backup(reason)


def maybe_create_rolling_backup(reason: str = "rolling-edit") -> Path | None:
    return maybe_create_interval_backup(reason, ROLLING_EDIT_BACKUP_INTERVAL)


def maybe_create_periodic_backup() -> Path | None:
    return maybe_create_interval_backup("periodic", AUTO_FULL_BACKUP_INTERVAL)


def create_shutdown_backup() -> Path | None:
    return create_full_backup("shutdown")


def start_periodic_backup_loop() -> None:
    global _BACKUP_LOOP_THREAD
    if _BACKUP_LOOP_THREAD and _BACKUP_LOOP_THREAD.is_alive():
        return
    _BACKUP_LOOP_STOP.clear()

    def run_loop() -> None:
        while not _BACKUP_LOOP_STOP.wait(timeout=300):
            try:
                maybe_create_periodic_backup()
            except Exception:
                continue

    _BACKUP_LOOP_THREAD = threading.Thread(
        target=run_loop,
        name="memory-anki-backup-loop",
        daemon=True,
    )
    _BACKUP_LOOP_THREAD.start()


def stop_periodic_backup_loop() -> None:
    _BACKUP_LOOP_STOP.set()


def _daily_backup_exists() -> bool:
    prefix = datetime.now().strftime("%Y%m%d")
    return any(
        child.is_dir() and child.name.startswith(prefix)
        for child in FULL_BACKUPS_DIR.iterdir()
    )


def _latest_full_backup() -> Path | None:
    folders = [child for child in FULL_BACKUPS_DIR.iterdir() if child.is_dir()]
    if not folders:
        return None
    return max(folders, key=lambda item: item.stat().st_mtime)


def _backup_age(folder: Path) -> timedelta:
    modified_at = datetime.fromtimestamp(folder.stat().st_mtime)
    return datetime.now() - modified_at
