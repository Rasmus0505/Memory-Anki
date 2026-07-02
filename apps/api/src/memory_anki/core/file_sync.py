from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from memory_anki.core.local_config import LocalRuntimeConfig
from memory_anki.core.storage_layout import ManagedStorageItem, get_backup_storage_items

SYNC_STATE_NAME = "state.json"
LOCAL_SYNC_STATE_NAME = "sync-state.json"
SYNC_MANIFEST_NAME = "sync-manifest.json"
LOCK_STALE_SECONDS = 15 * 60
SYNC_STATE_VERSION = 1


class SyncError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class SyncResult:
    ok: bool
    status: str
    message: str


def iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


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


def has_local_payload(app_home: Path) -> bool:
    for item in get_backup_storage_items():
        absolute = item.absolute_path(app_home)
        if absolute.is_file() and absolute.stat().st_size > 0:
            return True
        if absolute.is_dir() and any(absolute.iterdir()):
            return True
    return False


def compute_snapshot_hash(app_home: Path) -> str:
    digest = hashlib.sha256()
    for item in get_backup_storage_items():
        absolute = item.absolute_path(app_home)
        digest.update(f"ITEM\0{item.key}\0{item.relative_path}\0{item.kind}\0".encode())
        if item.kind == "directory" and absolute.exists():
            files = list(_iter_files_for_item(app_home, item))
            if not files:
                digest.update(f"EMPTY_DIR\0{item.relative_path}\0".encode())
            for relative_path, path in files:
                digest.update(f"FILE\0{relative_path}\0".encode())
                with path.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
        elif item.kind == "file":
            files = list(_iter_files_for_item(app_home, item))
            if not files:
                digest.update(f"MISSING_FILE\0{item.relative_path}\0".encode())
            for relative_path, path in files:
                digest.update(f"FILE\0{relative_path}\0".encode())
                with path.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
        else:
            digest.update(f"MISSING_DIR\0{item.relative_path}\0".encode())
    return digest.hexdigest()


def _read_runtime_generation(app_home: Path) -> int:
    state = _read_json(app_home / "migration-state.json")
    try:
        return max(1, int(state.get("runtime_generation") or 1))
    except (TypeError, ValueError):
        return 1


def _load_runtime_contract() -> dict[str, int]:
    contract_path = Path(__file__).resolve().parents[3] / "runtime-contract.json"
    payload = _read_json(contract_path)
    return {
        "runtime_generation": int(payload.get("runtime_generation") or 1),
        "min_supported_generation": int(payload.get("min_supported_generation") or 1),
        "max_supported_generation": int(payload.get("max_supported_generation") or 1),
    }


def _assert_remote_generation_compatible(remote_state: dict[str, Any]) -> None:
    remote_generation = int(remote_state.get("runtime_generation") or 1)
    contract = _load_runtime_contract()
    if remote_generation > contract["max_supported_generation"]:
        raise SyncError(
            "远端同步数据由更新版本创建，当前版本不支持读取。"
            f" remote={remote_generation}, max={contract['max_supported_generation']}"
        )
    if remote_generation < contract["min_supported_generation"]:
        raise SyncError(
            "远端同步数据版本过旧，当前版本要求先升级。"
            f" remote={remote_generation}, min={contract['min_supported_generation']}"
        )


def _detect_git_commit() -> str | None:
    repo_root = Path(__file__).resolve().parents[5]
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip() or None
    except Exception:
        return None


def _snapshot_name(revision: int, config: LocalRuntimeConfig) -> str:
    safe_device = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in config.device_name)
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
    resolved_hash = snapshot_hash or compute_snapshot_hash(app_home)
    commit = _detect_git_commit()
    manifest = {
        "version": SYNC_STATE_VERSION,
        "reason": reason,
        "revision": revision,
        "snapshot_hash": resolved_hash,
        "device_id": config.device_id,
        "device_name": config.device_name,
        "created_at": iso_now(),
        "runtime_generation": _read_runtime_generation(app_home),
        "git_commit": commit,
        "short_commit": commit[:8] if commit else None,
        "items": [item.key for item in get_backup_storage_items()],
    }
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(SYNC_MANIFEST_NAME, json.dumps(manifest, ensure_ascii=False, indent=2))
        added_dirs: set[str] = set()
        for item in get_backup_storage_items():
            absolute = item.absolute_path(app_home)
            if item.kind == "directory" and absolute.exists():
                dir_name = Path(item.relative_path).as_posix().rstrip("/") + "/"
                if dir_name not in added_dirs:
                    archive.writestr(dir_name, "")
                    added_dirs.add(dir_name)
            for relative_path, path in _iter_files_for_item(app_home, item):
                archive.write(path, relative_path)
    return manifest


def _extract_snapshot(zip_path: Path, temp_root: Path) -> dict[str, Any]:
    with zipfile.ZipFile(zip_path, "r") as archive:
        for member in archive.infolist():
            target = (temp_root / member.filename).resolve()
            if not str(target).startswith(str(temp_root.resolve())):
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
    with tempfile.TemporaryDirectory(prefix="memory-anki-sync-restore-") as temp_dir:
        temp_root = Path(temp_dir)
        manifest = _extract_snapshot(zip_path, temp_root)
        _restore_extracted_snapshot(temp_root, app_home)
        return manifest


class SyncLock:
    def __init__(self, lock_dir: Path, config: LocalRuntimeConfig):
        self.lock_dir = lock_dir
        self.config = config
        self.acquired = False

    def __enter__(self) -> SyncLock:
        self.lock_dir.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.lock_dir.mkdir()
        except FileExistsError:
            age = time.time() - self.lock_dir.stat().st_mtime
            if age <= LOCK_STALE_SECONDS:
                raise SyncError(f"同步锁仍在使用中，请稍后再试: {self.lock_dir}") from None
            shutil.rmtree(self.lock_dir, ignore_errors=True)
            self.lock_dir.mkdir()
        _write_json(
            self.lock_dir / "lock.json",
            {
                "device_id": self.config.device_id,
                "device_name": self.config.device_name,
                "created_at": iso_now(),
                "pid": os.getpid(),
            },
        )
        self.acquired = True
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        if self.acquired:
            shutil.rmtree(self.lock_dir, ignore_errors=True)


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
    conflict_name = f"conflict-{config.device_name}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
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
            current_hash = compute_snapshot_hash(app_home)
            remote_revision = int(remote_state.get("revision") or 0)
            local_revision = int(local_state.get("remote_revision") or 0)

            if remote_revision < local_revision:
                return SyncResult(
                    False,
                    "remote-stale",
                    "云盘中的同步版本比本机记录更旧，请等待云盘同步完成后再启动。",
                )
            if remote_revision == local_revision:
                if not local_state:
                    _write_local_state(
                        app_home,
                        config=config,
                        remote_state=remote_state,
                        local_hash=current_hash,
                        action="pull",
                    )
                return SyncResult(True, "up-to-date", "本机数据已是最新，无需拉取。")

            local_changed = _local_changed(local_state, current_hash, app_home)
            if local_changed:
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
                "runtime_generation": manifest.get("runtime_generation"),
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
    "SyncResult",
    "compute_snapshot_hash",
    "create_snapshot_zip",
    "has_local_payload",
    "pull_on_start",
    "push_on_stop",
    "restore_snapshot_zip",
]
