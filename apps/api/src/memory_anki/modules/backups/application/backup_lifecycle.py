from __future__ import annotations

import logging
import shutil
import threading
from datetime import datetime, timedelta
from pathlib import Path

from memory_anki.core.config import (
    DB_PATH,
    FULL_BACKUPS_DIR,
    RESCUE_BACKUPS_DIR,
    ROLLING_BACKUPS_DIR,
)
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

# 周期/关机/编辑均走轻量 rolling；全量仅每日启动与手动创建。
AUTO_ROLLING_BACKUP_INTERVAL = timedelta(hours=4)
ROLLING_EDIT_BACKUP_INTERVAL = timedelta(minutes=30)

# 保留策略：每次新建备份后自动清理超出上限的旧备份，避免磁盘无限增长。
MAX_FULL_BACKUPS = 3
MAX_ROLLING_BACKUPS = 6
MAX_RESCUE_BACKUPS = 3

_BACKUP_LOCK = threading.Lock()
_BACKUP_LOOP_THREAD: threading.Thread | None = None
_BACKUP_LOOP_STOP = threading.Event()


def timestamp_slug(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return current.strftime("%Y%m%d-%H%M%S")


def create_rescue_snapshot(reason: str) -> Path:
    """救援快照只拷数据库 + 迁移状态，不复制 PDF/视频等大媒体。"""
    with _BACKUP_LOCK:
        folder = RESCUE_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        write_storage_backup(folder, reason=reason, full=False)
        prune_old_backups(RESCUE_BACKUPS_DIR, MAX_RESCUE_BACKUPS)
        return folder


def ensure_daily_backup() -> Path | None:
    if _daily_full_backup_exists():
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
        folder = ROLLING_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        write_storage_backup(folder, reason=reason, full=False)
        prune_old_backups(ROLLING_BACKUPS_DIR, MAX_ROLLING_BACKUPS)
        return folder


def list_backups() -> list[dict]:
    results: list[dict] = []
    for kind, root in (
        ("full", FULL_BACKUPS_DIR),
        ("rolling", ROLLING_BACKUPS_DIR),
        ("rescue", RESCUE_BACKUPS_DIR),
    ):
        if not root.exists():
            continue
        for folder in sorted(root.iterdir(), reverse=True):
            if not folder.is_dir():
                continue
            manifest = read_storage_backup_manifest(folder)
            raw_included_items = manifest.get("included_items")
            included_items = raw_included_items if isinstance(raw_included_items, list) else []
            included_keys = {
                str(item.get("key"))
                for item in included_items
                if isinstance(item, dict) and item.get("included")
            }
            is_full = manifest.get("full")
            # 旧版 manifest 没有 full 字段：full 目录默认全量，rolling/rescue 默认轻量。
            if is_full is None:
                is_full = kind == "full"
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
                    "has_database": _backup_has_database(folder, manifest),
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
    manifest = read_storage_backup_manifest(source_dir)
    if not _backup_has_database(source_dir, manifest):
        raise FileNotFoundError("备份中缺少数据库快照。")
    assert_exclusive_runtime_operation(
        "Database restore",
        current_instance_id=current_runtime_instance_id(),
    )
    rescue = create_rescue_snapshot("before-db-restore")
    restore_storage_backup(source_dir)
    return rescue


def maybe_create_interval_backup(reason: str, minimum_interval: timedelta) -> Path | None:
    """兼容旧调用：按全量目录最近一份的年龄决定是否再打全量。"""
    latest = _latest_backup_in(FULL_BACKUPS_DIR)
    if latest and _backup_age(latest) < minimum_interval:
        return None
    return create_full_backup(reason)


def maybe_create_rolling_backup(reason: str = "rolling-edit") -> Path | None:
    """编辑触发的滚动备份，走轻量分支（仅 DB + migration-state）。"""
    latest = _latest_backup_in(ROLLING_BACKUPS_DIR)
    if latest and _backup_age(latest) < ROLLING_EDIT_BACKUP_INTERVAL:
        return None
    return create_rolling_backup(reason)


def maybe_create_periodic_backup() -> Path | None:
    """后台周期备份：轻量 rolling，避免把 PDF/视频反复整盘复制。"""
    latest = _latest_backup_in(ROLLING_BACKUPS_DIR)
    if latest and _backup_age(latest) < AUTO_ROLLING_BACKUP_INTERVAL:
        return None
    return create_rolling_backup("periodic")


def create_shutdown_backup() -> Path | None:
    return create_rolling_backup("shutdown")


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


def _backup_has_database(folder: Path, manifest: dict | None = None) -> bool:
    manifest = manifest or {}
    return any(path.exists() for path in _backup_database_candidates(folder, manifest))


def _backup_database_candidates(folder: Path, manifest: dict) -> list[Path]:
    candidates: list[Path] = []
    database_info = manifest.get("database")
    if isinstance(database_info, dict):
        relative_path = str(database_info.get("relative_path") or "").strip()
        if relative_path:
            candidates.append(folder / relative_path)

    included_items = manifest.get("included_items")
    if isinstance(included_items, list):
        for item in included_items:
            if not isinstance(item, dict) or item.get("key") != "database":
                continue
            relative_path = str(item.get("relative_path") or "").strip()
            if relative_path:
                candidates.append(folder / relative_path)

    candidates.extend(
        [
            folder / "data" / DB_PATH.name,
            folder / DB_PATH.name,
        ]
    )
    return list(dict.fromkeys(candidates))


def _daily_full_backup_exists() -> bool:
    """仅当 full 目录下存在当日全量备份时返回 True（忽略 rolling）。"""
    prefix = datetime.now().strftime("%Y%m%d")
    if not FULL_BACKUPS_DIR.exists():
        return False
    for child in FULL_BACKUPS_DIR.iterdir():
        if not child.is_dir() or not child.name.startswith(prefix):
            continue
        manifest = read_storage_backup_manifest(child)
        is_full = manifest.get("full")
        if is_full is None:
            # full 目录内无 manifest 字段时按全量计
            is_full = True
        if bool(is_full):
            return True
    return False


# 兼容旧测试/调用方名称
def _daily_backup_exists() -> bool:
    return _daily_full_backup_exists()


def _latest_backup_in(root: Path) -> Path | None:
    if not root.exists():
        return None
    folders = [child for child in root.iterdir() if child.is_dir()]
    if not folders:
        return None
    return max(folders, key=lambda item: item.stat().st_mtime)


def _latest_full_backup() -> Path | None:
    return _latest_backup_in(FULL_BACKUPS_DIR)


def _backup_age(folder: Path) -> timedelta:
    modified_at = datetime.fromtimestamp(folder.stat().st_mtime)
    return datetime.now() - modified_at
