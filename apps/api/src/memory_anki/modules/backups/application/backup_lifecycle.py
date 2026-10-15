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
    STORAGE_ROOT_LEARNING,
)
from memory_anki.core.runtime_activity import (
    assert_exclusive_runtime_operation,
    current_runtime_instance_id,
)
from memory_anki.infrastructure.db._tables._base import get_session
from memory_anki.infrastructure.db.maintenance import analyze_database
from memory_anki.modules.backups.application.backup_palace_versions import (
    prune_expired_palace_versions,
)
from memory_anki.modules.backups.application.storage_backup import (
    read_storage_backup_manifest,
    restore_storage_backup,
    staging_root,
    write_storage_backup,
)

logger = logging.getLogger(__name__)

# 自动备份只有一种：每个本地日历日第一次启动时做一份轻量数据库快照（不含附件）。
# 编辑、周期、关机都不再写 U 盘：学习中途复制整库会拖慢每一次评分。
# 启动后延迟一段时间再开始，避开刚开始学习的几分钟。
DAILY_BACKUP_STARTUP_DELAY_SECONDS = 120.0

# 保留策略：每次新建备份后自动清理超出上限的旧备份，避免磁盘无限增长。
MAX_FULL_BACKUPS = 1
MAX_ROLLING_BACKUPS = 3
MAX_RESCUE_BACKUPS = 2

_BACKUP_LOCK = threading.Lock()
# Waiting for a backup that is already running must never block the caller for long.
_BACKUP_LOCK_WAIT_SECONDS = 5.0
_STARTUP_BACKUP_STOP = threading.Event()


def timestamp_slug(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return current.strftime("%Y%m%d-%H%M%S")


def create_rescue_snapshot(reason: str) -> Path:
    """替换前保护数据库、附件和迁移状态。"""
    with _BACKUP_LOCK:
        folder = RESCUE_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        write_storage_backup(folder, reason=reason, full=False, scope="rescue")
        prune_old_backups(RESCUE_BACKUPS_DIR, MAX_RESCUE_BACKUPS)
        return folder


def ensure_daily_backup() -> Path | None:
    """每个本地日历日至多一份轻量数据库快照，不复制 PDF/视频。

    The check and the write share one lock, so a launcher-triggered check and the
    boot-time one can never both write today's snapshot.
    """
    with _BACKUP_LOCK:
        if _daily_rolling_backup_exists():
            return None
        return _write_rolling_backup_locked("startup")


def create_full_backup(reason: str) -> Path:
    with _BACKUP_LOCK:
        folder = FULL_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
        write_storage_backup(folder, reason=reason, full=True)
        prune_old_backups(FULL_BACKUPS_DIR, MAX_FULL_BACKUPS)
    analyze_database()
    return folder


def create_rolling_backup(reason: str) -> Path:
    """轻量备份：数据库和迁移状态；不含附件。"""
    with _BACKUP_LOCK:
        return _write_rolling_backup_locked(reason)


def _write_rolling_backup_locked(reason: str) -> Path:
    folder = ROLLING_BACKUPS_DIR / f"{timestamp_slug()}-{reason}"
    write_storage_backup(folder, reason=reason, full=False)
    prune_old_backups(ROLLING_BACKUPS_DIR, MAX_ROLLING_BACKUPS)
    return folder


def request_rolling_backup(reason: str = "rolling-edit") -> bool:
    """Retired: edits never write a backup any more.

    Kept as a no-op so the edit call sites stay harmless until they are removed.
    The only automatic backup is the once-per-local-day startup snapshot.
    """
    logger.debug("edit-triggered backup %s ignored; daily startup backup only", reason)
    return False


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
            if not _is_backup_folder(folder):
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
    """兼容旧调用：按 rolling 目录最近一份的年龄决定是否再打轻量备份。"""
    latest = _latest_backup_in(ROLLING_BACKUPS_DIR)
    if latest and _backup_age(latest) < minimum_interval:
        return None
    return create_rolling_backup(reason)


def maybe_create_rolling_backup(reason: str = "rolling-edit") -> Path | None:
    """编辑触发的滚动备份：只排队，永远不在请求线程里做。"""
    request_rolling_backup(reason)
    return None


def start_startup_backups(
    delay_seconds: float = DAILY_BACKUP_STARTUP_DELAY_SECONDS,
) -> threading.Thread:
    """Clean crash leftovers, then take today's backup once, off the serving path.

    Runs in every startup mode (desktop/PWA healthcheck included). The daily check
    uses the machine's local date, so it is at most one backup per local day.
    """

    def run() -> None:
        try:
            cleanup_stale_backup_staging()
            if _STARTUP_BACKUP_STOP.wait(timeout=delay_seconds):
                return
            ensure_daily_backup()
            # Prune only once today's snapshot exists, so history is never dropped
            # before a copy of it has been written.
            if _daily_rolling_backup_exists():
                _prune_expired_palace_versions()
        except Exception:
            logger.exception("startup backup failed")

    thread = threading.Thread(target=run, name="memory-anki-startup-backup", daemon=True)
    thread.start()
    return thread


def _prune_expired_palace_versions() -> int:
    session = get_session()
    try:
        removed = prune_expired_palace_versions(session)
    finally:
        session.close()
    if removed:
        logger.info("pruned %s palace versions older than the retention window", removed)
    return removed


def stop_startup_backups() -> None:
    _STARTUP_BACKUP_STOP.set()


def prune_old_backups(root: Path, keep: int) -> int:
    """按 mtime 倒序保留最近 keep 份备份目录，删除其余。

    返回被删除的备份数量。出错时记录日志但不抛出，避免影响主备份流程。
    """
    if keep <= 0 or not root.exists():
        return 0
    try:
        folders = [child for child in root.iterdir() if _is_backup_folder(child)]
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
            folder / STORAGE_ROOT_LEARNING / DB_PATH.name,
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


def _daily_rolling_backup_exists() -> bool:
    prefix = datetime.now().strftime("%Y%m%d")
    if not ROLLING_BACKUPS_DIR.exists():
        return False
    return any(
        _is_backup_folder(child) and child.name.startswith(prefix)
        for child in ROLLING_BACKUPS_DIR.iterdir()
    )


# 兼容旧测试/调用方名称
def _daily_backup_exists() -> bool:
    return _daily_full_backup_exists()


def _is_backup_folder(child: Path) -> bool:
    # ``.backup-stage-*`` and other dot-folders are half-written staging, never a backup.
    return child.is_dir() and not child.name.startswith(".")


def cleanup_stale_backup_staging() -> int:
    """Remove staging left behind by a crash or kill mid-backup."""
    removed = 0
    roots = [ROLLING_BACKUPS_DIR, FULL_BACKUPS_DIR, RESCUE_BACKUPS_DIR, staging_root()]
    for root in roots:
        if not root.exists():
            continue
        try:
            children = list(root.iterdir())
        except OSError:
            continue
        for child in children:
            if child.is_dir() and child.name.startswith(".backup-stage-"):
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
    return removed


def _latest_backup_in(root: Path) -> Path | None:
    if not root.exists():
        return None
    folders = [child for child in root.iterdir() if _is_backup_folder(child)]
    if not folders:
        return None
    return max(folders, key=lambda item: item.stat().st_mtime)


def _latest_full_backup() -> Path | None:
    return _latest_backup_in(FULL_BACKUPS_DIR)


def _backup_age(folder: Path) -> timedelta:
    modified_at = datetime.fromtimestamp(folder.stat().st_mtime)
    return datetime.now() - modified_at
