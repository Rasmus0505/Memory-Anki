from __future__ import annotations

import logging
import shutil
import threading
from datetime import datetime, timedelta
from pathlib import Path

from memory_anki.core.config import DB_PATH, FULL_BACKUPS_DIR, RESCUE_BACKUPS_DIR
from memory_anki.core.runtime_activity import (
    assert_exclusive_runtime_operation,
    current_runtime_instance_id,
)
from memory_anki.infrastructure.db.maintenance import analyze_database
from memory_anki.modules.backups.application.storage_backup import (
    read_storage_backup_manifest,
    restore_storage_backup,
    write_storage_backup,
)

logger = logging.getLogger(__name__)

AUTO_FULL_BACKUP_INTERVAL = timedelta(hours=4)
ROLLING_EDIT_BACKUP_INTERVAL = timedelta(minutes=30)

# 保留策略：每次新建备份后自动清理超出上限的旧备份，避免磁盘无限增长。
MAX_FULL_BACKUPS = 8
MAX_RESCUE_BACKUPS = 5

_BACKUP_LOCK = threading.Lock()
_BACKUP_LOOP_THREAD: threading.Thread | None = None
_BACKUP_LOOP_STOP = threading.Event()


def timestamp_slug(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return current.strftime("%Y%m%d-%H%M%S")


def create_rescue_snapshot(reason: str) -> Path:
    with _BACKUP_LOCK:
        folder = RESCUE_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        write_storage_backup(folder, reason=reason, full=True)
        prune_old_backups(RESCUE_BACKUPS_DIR, MAX_RESCUE_BACKUPS)
        return folder


def ensure_daily_backup() -> Path | None:
    if _daily_backup_exists():
        return None
    return create_full_backup("startup")


def create_full_backup(reason: str) -> Path:
    with _BACKUP_LOCK:
        folder = FULL_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        write_storage_backup(folder, reason=reason, full=True)
        prune_old_backups(FULL_BACKUPS_DIR, MAX_FULL_BACKUPS)
        analyze_database()
        return folder


def create_rolling_backup(reason: str) -> Path:
    """轻量备份：只复制数据库 + 迁移状态，不含大媒体目录。"""
    with _BACKUP_LOCK:
        folder = FULL_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        write_storage_backup(folder, reason=reason, full=False)
        prune_old_backups(FULL_BACKUPS_DIR, MAX_FULL_BACKUPS)
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
            is_full = manifest.get("full")
            # 旧版 manifest 没有 full 字段，默认按全量处理（向后兼容）。
            if is_full is None:
                is_full = True
            scope = manifest.get("scope") or ("full" if is_full else "rolling")
            results.append(
                {
                    "kind": kind,
                    "scope": scope,
                    "full": bool(is_full),
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
    assert_exclusive_runtime_operation(
        "Database restore",
        current_instance_id=current_runtime_instance_id(),
    )
    rescue = create_rescue_snapshot("before-db-restore")
    restore_storage_backup(source_dir)
    return rescue


def maybe_create_interval_backup(reason: str, minimum_interval: timedelta) -> Path | None:
    latest = _latest_full_backup()
    if latest and _backup_age(latest) < minimum_interval:
        return None
    return create_full_backup(reason)


def maybe_create_rolling_backup(reason: str = "rolling-edit") -> Path | None:
    """编辑触发的滚动备份，走轻量分支（仅 DB + migration-state）。"""
    latest = _latest_full_backup()
    if latest and _backup_age(latest) < ROLLING_EDIT_BACKUP_INTERVAL:
        return None
    return create_rolling_backup(reason)


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
                logger.exception("periodic backup loop iteration failed")
                continue

    _BACKUP_LOOP_THREAD = threading.Thread(
        target=run_loop,
        name="memory-anki-backup-loop",
        daemon=True,
    )
    _BACKUP_LOOP_THREAD.start()


def stop_periodic_backup_loop() -> None:
    _BACKUP_LOOP_STOP.set()


def prune_old_backups(root: Path, keep: int) -> int:
    """按 mtime 倒序保留最近 keep 份备份目录，删除其余。

    返回被删除的备份数量。出错时记录日志但不抛出，避免影响主备份流程。
    """
    if keep <= 0 or not root.exists():
        return 0
    try:
        folders = [child for child in root.iterdir() if child.is_dir()]
    except OSError:
        return 0
    if len(folders) <= keep:
        return 0
    folders.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    removed = 0
    for folder in folders[keep:]:
        try:
            shutil.rmtree(folder)
            removed += 1
        except OSError:
            logger.warning("failed to prune old backup: %s", folder, exc_info=True)
    return removed


def _daily_backup_exists() -> bool:
    prefix = datetime.now().strftime("%Y%m%d")
    if not FULL_BACKUPS_DIR.exists():
        return False
    return any(
        child.is_dir() and child.name.startswith(prefix)
        for child in FULL_BACKUPS_DIR.iterdir()
    )


def _latest_full_backup() -> Path | None:
    if not FULL_BACKUPS_DIR.exists():
        return None
    folders = [child for child in FULL_BACKUPS_DIR.iterdir() if child.is_dir()]
    if not folders:
        return None
    return max(folders, key=lambda item: item.stat().st_mtime)


def _backup_age(folder: Path) -> timedelta:
    modified_at = datetime.fromtimestamp(folder.stat().st_mtime)
    return datetime.now() - modified_at
