from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import sqlite3
import tempfile
import time
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from memory_anki.core.file_sync_lock import SyncError, SyncLock
from memory_anki.core.files import safe_filename_part
from memory_anki.core.local_config import LocalRuntimeConfig
from memory_anki.core.runtime import detect_git_commit
from memory_anki.core.storage_layout import ManagedStorageItem, get_backup_storage_items
from memory_anki.core.time import iso_utc_now

SYNC_STATE_NAME = "state.json"
LOCAL_SYNC_STATE_NAME = "sync-state.json"
SYNC_MANIFEST_NAME = "sync-manifest.json"
SYNC_STATE_VERSION = 1
SNAPSHOT_PROGRESS_INTERVAL_SECONDS = 5
SNAPSHOT_CHUNK_SIZE = 1024 * 1024

logger = logging.getLogger(__name__)

@dataclass(frozen=True, slots=True)
class SyncResult:
    ok: bool
    status: str
    message: str


def iso_now() -> str:
    return iso_utc_now(timespec="seconds")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _sync_paths(config: LocalRuntimeConfig) -> dict[str, Path]:
    if config.sync_root is None:
        raise SyncError("同步未配置 sync_root。")
    return {
        "root": config.sync_root,
        "state": config.sync_root / SYNC_STATE_NAME,
        "snapshots": config.sync_root / "snapshots",
        "conflicts": config.sync_root / "conflicts",
        "locks": config.sync_root / "locks",
    }


def _local_state_path(app_home: Path) -> Path:
    return app_home / LOCAL_SYNC_STATE_NAME


def _database_sidecar_paths(path: Path) -> tuple[Path, Path]:
    return (
        path.with_name(f"{path.name}-wal"),
        path.with_name(f"{path.name}-shm"),
    )


def _database_file_info(app_home: Path) -> dict[str, Any]:
    database_item = next(
        (item for item in get_backup_storage_items() if item.key == "database"),
        None,
    )
    if database_item is None:
        return {"included": False}
    database_path = database_item.absolute_path(app_home)
    sidecars = []
    for sidecar in _database_sidecar_paths(database_path):
        sidecars.append(
            {
                "name": sidecar.name,
                "relative_path": (Path(database_item.relative_path).parent / sidecar.name).as_posix(),
                "exists": sidecar.exists(),
                "size_bytes": sidecar.stat().st_size if sidecar.exists() else 0,
            }
        )
    return {
        "included": database_path.exists(),
        "relative_path": database_item.relative_path,
        "size_bytes": database_path.stat().st_size if database_path.exists() else 0,
        "sidecars": sidecars,
    }


def _database_item() -> ManagedStorageItem | None:
    return next(
        (item for item in get_backup_storage_items() if item.key == "database"),
        None,
    )


def _checkpoint_sqlite_database(app_home: Path, *, require_complete: bool) -> bool:
    database_item = _database_item()
    if database_item is None:
        return False
    database_path = database_item.absolute_path(app_home)
    if not database_path.exists():
        return False
    try:
        with database_path.open("rb") as handle:
            header = handle.read(16)
    except OSError:
        if require_complete:
            raise SyncError(f"无法读取本机数据库文件: {database_path}") from None
        return False
    if header != b"SQLite format 3\x00":
        return False
    try:
        connection = sqlite3.connect(str(database_path))
        try:
            row = connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        finally:
            connection.close()
    except sqlite3.Error as exc:
        if require_complete:
            raise SyncError(f"同步前 SQLite WAL checkpoint 失败: {exc}") from None
        logger.warning("sync SQLite WAL checkpoint failed", exc_info=True)
        return False
    completed = _checkpoint_completed(row)
    if not completed and require_complete:
        raise SyncError(f"同步前 SQLite WAL checkpoint 未完成: {row!r}")
    return completed


def _checkpoint_completed(row) -> bool:
    if row is None or len(row) < 3:
        return False
    busy, log_frames, checkpointed_frames = row[0], row[1], row[2]
    try:
        return int(busy or 0) == 0 and int(checkpointed_frames or 0) >= int(log_frames or 0)
    except (TypeError, ValueError):
        return False


def _iter_files_for_item(app_home: Path, item: ManagedStorageItem) -> Iterable[tuple[str, Path]]:
    absolute = item.absolute_path(app_home)
    base_relative = Path(item.relative_path)
    if item.kind == "file":
        if absolute.exists():
            yield base_relative.as_posix(), absolute
        if item.key == "database":
            for sidecar in _database_sidecar_paths(absolute):
                if sidecar.exists():
                    yield (base_relative.parent / sidecar.name).as_posix(), sidecar
        return

    if not absolute.exists():
        return
    for path in sorted(p for p in absolute.rglob("*") if p.is_file()):
        yield path.relative_to(app_home).as_posix(), path


@dataclass(slots=True)
class _SnapshotProgress:
    action: str
    last_report: float = 0.0
    file_count: int = 0
    byte_count: int = 0

    def __post_init__(self) -> None:
        self.last_report = time.monotonic()

    def add_file(self, byte_count: int = 0) -> None:
        self.file_count += 1
        self.byte_count += byte_count

    def add_bytes(self, byte_count: int) -> None:
        self.byte_count += byte_count

    def should_report(self) -> bool:
        if time.monotonic() - self.last_report < SNAPSHOT_PROGRESS_INTERVAL_SECONDS:
            return False
        self.last_report = time.monotonic()
        return True

    def report(self, extra: str = "") -> None:
        logger.info(
            "%s: %s files, %.1f MB%s",
            self.action,
            self.file_count,
            self.byte_count / (1024 * 1024),
            extra,
        )

    def maybe_report(self, extra: str = "") -> None:
        if self.should_report():
            self.report(extra)

    def report_complete(self, message: str) -> None:
        logger.info(message, self.file_count, self.byte_count / (1024 * 1024))


def has_local_payload(app_home: Path) -> bool:
    for item in get_backup_storage_items():
        absolute = item.absolute_path(app_home)
        if absolute.is_file() and absolute.stat().st_size > 0:
            return True
        if absolute.is_dir() and any(absolute.iterdir()):
            return True
    return False


def compute_snapshot_hash(app_home: Path) -> str:
    _checkpoint_sqlite_database(app_home, require_complete=True)
    logger.info("scanning local payload and computing snapshot hash: %s", app_home)
    digest = hashlib.sha256()
    progress = _SnapshotProgress("snapshot hash progress")
    for item in get_backup_storage_items():
        absolute = item.absolute_path(app_home)
        digest.update(f"ITEM\0{item.key}\0{item.relative_path}\0{item.kind}\0".encode())
        saw_file = False
        for relative_path, path in _iter_files_for_item(app_home, item):
            saw_file = True
            digest.update(f"FILE\0{relative_path}\0".encode())
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(SNAPSHOT_CHUNK_SIZE), b""):
                    digest.update(chunk)
                    progress.add_bytes(len(chunk))
            progress.add_file()
            progress.maybe_report()
        if saw_file:
            continue
        if item.kind == "directory" and absolute.exists():
            digest.update(f"EMPTY_DIR\0{item.relative_path}\0".encode())
        elif item.kind == "file":
            digest.update(f"MISSING_FILE\0{item.relative_path}\0".encode())
        else:
            digest.update(f"MISSING_DIR\0{item.relative_path}\0".encode())
    snapshot_hash = digest.hexdigest()
    progress.report_complete("snapshot hash completed: %s files, %.1f MB")
    return snapshot_hash


def _assert_remote_generation_compatible(remote_state: dict[str, Any]) -> None:
    return None


def _snapshot_name(revision: int, config: LocalRuntimeConfig) -> str:
    safe_device = safe_filename_part(config.device_name, fallback="device")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"rev-{revision:06d}-{safe_device}-{timestamp}.zip"


def create_snapshot_zip(
    app_home: Path,
    destination: Path,
    *,
    config: LocalRuntimeConfig,
    revision: int,
    reason: str,
    snapshot_hash: str | None = None,
) -> dict[str, Any]:
    app_home.mkdir(parents=True, exist_ok=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    _checkpoint_sqlite_database(app_home, require_complete=True)
    logger.info("writing sync snapshot: %s", destination)
    backup_items = get_backup_storage_items()
    resolved_hash = snapshot_hash or compute_snapshot_hash(app_home)
    commit = detect_git_commit()
    manifest = {
        "version": SYNC_STATE_VERSION,
        "reason": reason,
        "revision": revision,
        "snapshot_hash": resolved_hash,
        "device_id": config.device_id,
        "device_name": config.device_name,
        "created_at": iso_now(),
        "git_commit": commit,
        "short_commit": commit[:8] if commit else None,
        "items": [item.key for item in backup_items],
        "database": _database_file_info(app_home),
    }
    progress = _SnapshotProgress("snapshot write progress")
    partial_destination = destination.parent / f".{destination.name}.{os.getpid()}.tmp"
    try:
        with zipfile.ZipFile(partial_destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(SYNC_MANIFEST_NAME, json.dumps(manifest, ensure_ascii=False, indent=2))
            added_dirs: set[str] = set()
            for item in backup_items:
                absolute = item.absolute_path(app_home)
                if item.kind == "directory" and absolute.exists():
                    dir_name = Path(item.relative_path).as_posix().rstrip("/") + "/"
                    if dir_name not in added_dirs:
                        archive.writestr(dir_name, "")
                        added_dirs.add(dir_name)
                for relative_path, path in _iter_files_for_item(app_home, item):
                    archive.write(path, relative_path)
                    try:
                        source_size = path.stat().st_size
                    except OSError:
                        source_size = 0
                    progress.add_file(source_size)
                    if progress.should_report():
                        zip_mb = partial_destination.stat().st_size / (1024 * 1024)
                        progress.report(extra=f", zip {zip_mb:.1f} MB")
        os.replace(partial_destination, destination)
    except Exception:
        partial_destination.unlink(missing_ok=True)
        raise
    logger.info("sync snapshot written: %s", destination)
    return manifest


def _extract_snapshot(zip_path: Path, temp_root: Path) -> dict[str, Any]:
    resolved_temp_root = temp_root.resolve()
    with zipfile.ZipFile(zip_path, "r") as archive:
        for member in archive.infolist():
            target = (temp_root / member.filename).resolve()
            if not target.is_relative_to(resolved_temp_root):
                raise SyncError(f"同步快照包含非法路径: {member.filename}")
        archive.extractall(temp_root)
    manifest = _read_json(temp_root / SYNC_MANIFEST_NAME)
    if not manifest:
        raise SyncError(f"同步快照缺少 {SYNC_MANIFEST_NAME}: {zip_path}")
    return manifest


def _restore_extracted_snapshot(temp_root: Path, app_home: Path) -> None:
    app_home.mkdir(parents=True, exist_ok=True)
    for item in get_backup_storage_items():
        source = temp_root / item.relative_path
        destination = item.absolute_path(app_home)
        if item.kind == "directory":
            if destination.exists():
                shutil.rmtree(destination)
            if source.exists():
                shutil.copytree(source, destination)
            elif item.required:
                destination.mkdir(parents=True, exist_ok=True)
            continue

        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.exists():
            shutil.copy2(source, destination)
        elif item.required and destination.exists():
            destination.unlink()
        if item.key == "database":
            for sidecar in _database_sidecar_paths(destination):
                source_sidecar = temp_root / item.relative_path
                source_sidecar = source_sidecar.with_name(sidecar.name)
                if source_sidecar.exists():
                    shutil.copy2(source_sidecar, sidecar)
                elif sidecar.exists():
                    sidecar.unlink()


def restore_snapshot_zip(zip_path: Path, app_home: Path) -> dict[str, Any]:
    logger.info("restoring remote snapshot: %s", zip_path)
    with tempfile.TemporaryDirectory(prefix="memory-anki-sync-restore-") as temp_dir:
        temp_root = Path(temp_dir)
        manifest = _extract_snapshot(zip_path, temp_root)
        _restore_extracted_snapshot(temp_root, app_home)
        logger.info("remote snapshot restored")
        return manifest


def _remote_snapshot_path(remote_state: dict[str, Any], paths: dict[str, Path]) -> Path:
    snapshot_name = str(remote_state.get("snapshot_name") or "").strip()
    if not snapshot_name:
        raise SyncError("远端 state.json 缺少 snapshot_name。")
    return paths["snapshots"] / snapshot_name


def _local_changed(local_state: dict[str, Any], current_hash: str, app_home: Path) -> bool:
    previous_hash = local_state.get("local_snapshot_hash")
    if not previous_hash:
        return has_local_payload(app_home)
    return str(previous_hash) != current_hash


def _write_local_state(
    app_home: Path,
    *,
    config: LocalRuntimeConfig,
    remote_state: dict[str, Any],
    local_hash: str,
    action: str,
) -> None:
    now = iso_now()
    existing = _read_json(_local_state_path(app_home))
    next_state = {
        **existing,
        "version": SYNC_STATE_VERSION,
        "device_id": config.device_id,
        "device_name": config.device_name,
        "remote_revision": int(remote_state.get("revision") or 0),
        "remote_snapshot_hash": remote_state.get("snapshot_hash"),
        "local_snapshot_hash": local_hash,
        "last_sync_at": now,
    }
    if action == "pull":
        next_state["last_pull_at"] = now
    if action == "push":
        next_state["last_push_at"] = now
    _write_json(_local_state_path(app_home), next_state)


def _write_conflict_snapshot(
    app_home: Path,
    paths: dict[str, Path],
    *,
    config: LocalRuntimeConfig,
    reason: str,
    snapshot_hash: str,
) -> Path:
    safe_device = safe_filename_part(config.device_name, fallback="device")
    conflict_name = f"conflict-{safe_device}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    conflict_path = paths["conflicts"] / conflict_name
    create_snapshot_zip(
        app_home,
        conflict_path,
        config=config,
        revision=0,
        reason=reason,
        snapshot_hash=snapshot_hash,
    )
    return conflict_path


def peek_pull_on_start(config: LocalRuntimeConfig) -> SyncResult:
    """Revision-only startup sync check (百度网盘数据，不是 GitHub).

    Does not restore snapshots or stop services. Status meanings for launchers:
    - disabled / no-remote / up-to-date: safe to keep a healthy shared service running
    - needs-pull: remote has a newer revision; caller must stop the service before pull_on_start
    - other ok=False: surface the error and do not start
    """
    if not config.sync_enabled or not config.sync_on_start:
        return SyncResult(True, "disabled", "同步未启用或启动同步已关闭。")
    if config.sync_root is None:
        return SyncResult(False, "misconfigured", "同步已启用，但 sync_root 未配置。")

    paths = _sync_paths(config)
    app_home = config.local_app_home
    try:
        with SyncLock(paths["locks"] / "sync.lock", config):
            remote_state = _read_json(paths["state"])
            if not remote_state:
                return SyncResult(True, "no-remote", "远端同步目录尚未初始化，本次启动跳过拉取。")
            _assert_remote_generation_compatible(remote_state)
            local_state = _read_json(_local_state_path(app_home))
            remote_revision = int(remote_state.get("revision") or 0)
            local_revision = int(local_state.get("remote_revision") or 0)
            logger.info(
                "sync peek revision check: local revision %s, remote revision %s",
                local_revision,
                remote_revision,
            )
            if remote_revision < local_revision:
                return SyncResult(
                    False,
                    "remote-stale",
                    "云盘中的同步版本比本机记录更旧，请等待云盘同步完成后再启动。",
                )
            if remote_revision == local_revision:
                return SyncResult(True, "up-to-date", "本机数据已是最新，无需拉取。")
            return SyncResult(
                True,
                "needs-pull",
                f"远端 revision {remote_revision} 新于本机 {local_revision}，需要停服务后拉取。",
            )
    except SyncError as exc:
        return SyncResult(False, "error", str(exc))


def pull_on_start(config: LocalRuntimeConfig) -> SyncResult:
    if not config.sync_enabled or not config.sync_on_start:
        return SyncResult(True, "disabled", "同步未启用或启动同步已关闭。")
    if config.sync_root is None:
        return SyncResult(False, "misconfigured", "同步已启用，但 sync_root 未配置。")

    paths = _sync_paths(config)
    app_home = config.local_app_home
    try:
        with SyncLock(paths["locks"] / "sync.lock", config):
            remote_state = _read_json(paths["state"])
            if not remote_state:
                return SyncResult(True, "no-remote", "远端同步目录尚未初始化，本次启动跳过拉取。")
            _assert_remote_generation_compatible(remote_state)
            local_state = _read_json(_local_state_path(app_home))
            remote_revision = int(remote_state.get("revision") or 0)
            local_revision = int(local_state.get("remote_revision") or 0)
            logger.info(
                "sync revision check: local revision %s, remote revision %s",
                local_revision,
                remote_revision,
            )

            if remote_revision < local_revision:
                return SyncResult(
                    False,
                    "remote-stale",
                    "云盘中的同步版本比本机记录更旧，请等待云盘同步完成后再启动。",
                )
            if remote_revision == local_revision:
                if local_state:
                    return SyncResult(True, "up-to-date", "本机数据已是最新，无需拉取。")
                current_hash = compute_snapshot_hash(app_home)
                if not local_state:
                    _write_local_state(
                        app_home,
                        config=config,
                        remote_state=remote_state,
                        local_hash=current_hash,
                        action="pull",
                    )
                return SyncResult(True, "up-to-date", "本机数据已是最新，无需拉取。")

            current_hash = compute_snapshot_hash(app_home)
            local_changed = _local_changed(local_state, current_hash, app_home)
            if local_changed:
                logger.info("local and remote changes detected; writing conflict snapshot")
                conflict_path = _write_conflict_snapshot(
                    app_home,
                    paths,
                    config=config,
                    reason="startup-conflict",
                    snapshot_hash=current_hash,
                )
                return SyncResult(
                    False,
                    "conflict",
                    "检测到远端和本机都发生过变化，已阻止启动同步。"
                    f" 本机快照已保存到: {conflict_path}",
                )

            snapshot_path = _remote_snapshot_path(remote_state, paths)
            rescue_path = _write_conflict_snapshot(
                app_home,
                paths,
                config=config,
                reason="before-sync-restore",
                snapshot_hash=current_hash,
            )
            manifest = restore_snapshot_zip(snapshot_path, app_home)
            restored_hash = str(manifest.get("snapshot_hash") or compute_snapshot_hash(app_home))
            _write_local_state(
                app_home,
                config=config,
                remote_state=remote_state,
                local_hash=restored_hash,
                action="pull",
            )
            return SyncResult(
                True,
                "pulled",
                f"已从云盘拉取 revision {remote_revision}。本机恢复前快照: {rescue_path}",
            )
    except SyncError as exc:
        return SyncResult(False, "error", str(exc))


def push_on_stop(config: LocalRuntimeConfig) -> SyncResult:
    if not config.sync_enabled or not config.sync_on_stop:
        return SyncResult(True, "disabled", "同步未启用或停止同步已关闭。")
    if config.sync_root is None:
        return SyncResult(False, "misconfigured", "同步已启用，但 sync_root 未配置。")

    paths = _sync_paths(config)
    app_home = config.local_app_home
    try:
        for path in (paths["root"], paths["snapshots"], paths["conflicts"], paths["locks"]):
            path.mkdir(parents=True, exist_ok=True)
        with SyncLock(paths["locks"] / "sync.lock", config):
            if not has_local_payload(app_home):
                return SyncResult(True, "empty-local", "本机还没有可同步的数据，跳过推送。")
            remote_state = _read_json(paths["state"])
            local_state = _read_json(_local_state_path(app_home))
            current_hash = compute_snapshot_hash(app_home)
            remote_revision = int(remote_state.get("revision") or 0)
            local_revision = int(local_state.get("remote_revision") or 0)
            local_changed = _local_changed(local_state, current_hash, app_home)

            if remote_state:
                _assert_remote_generation_compatible(remote_state)
            if remote_revision < local_revision:
                return SyncResult(
                    False,
                    "remote-stale",
                    "云盘中的同步版本比本机记录更旧，请等待云盘同步完成后再停止同步。",
                )
            if remote_revision > local_revision:
                if local_changed:
                    conflict_path = _write_conflict_snapshot(
                        app_home,
                        paths,
                        config=config,
                        reason="shutdown-conflict",
                        snapshot_hash=current_hash,
                    )
                    return SyncResult(
                        False,
                        "conflict",
                        "检测到另一台设备已经推送过新数据，同时本机也有改动。"
                        f" 已保留本机冲突快照: {conflict_path}",
                    )
                _write_local_state(
                    app_home,
                    config=config,
                    remote_state=remote_state,
                    local_hash=current_hash,
                    action="pull",
                )
                return SyncResult(True, "remote-newer", "远端已有更新且本机无改动，跳过推送。")

            if remote_state and not local_changed:
                return SyncResult(True, "unchanged", "本机数据没有变化，跳过推送。")

            next_revision = remote_revision + 1
            snapshot_name = _snapshot_name(next_revision, config)
            snapshot_path = paths["snapshots"] / snapshot_name
            manifest = create_snapshot_zip(
                app_home,
                snapshot_path,
                config=config,
                revision=next_revision,
                reason="shutdown-push",
                snapshot_hash=current_hash,
            )
            next_remote_state = {
                "version": SYNC_STATE_VERSION,
                "revision": next_revision,
                "snapshot_name": snapshot_name,
                "snapshot_hash": current_hash,
                "device_id": config.device_id,
                "device_name": config.device_name,
                "pushed_at": iso_now(),
                "git_commit": manifest.get("git_commit"),
                "short_commit": manifest.get("short_commit"),
            }
            _write_json(paths["state"], next_remote_state)
            _write_local_state(
                app_home,
                config=config,
                remote_state=next_remote_state,
                local_hash=current_hash,
                action="push",
            )
            return SyncResult(True, "pushed", f"已推送本机数据到云盘 revision {next_revision}。")
    except SyncError as exc:
        return SyncResult(False, "error", str(exc))


__all__ = [
    "SyncError",
    "SyncLock",
    "SyncResult",
    "compute_snapshot_hash",
    "create_snapshot_zip",
    "has_local_payload",
    "peek_pull_on_start",
    "pull_on_start",
    "push_on_stop",
    "restore_snapshot_zip",
]
