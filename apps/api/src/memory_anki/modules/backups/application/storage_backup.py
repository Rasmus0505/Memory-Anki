from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from memory_anki.core.config import APP_HOME, BACKUPS_DIR, ensure_runtime_dirs
from memory_anki.core.runtime import build_runtime_info
from memory_anki.core.storage_layout import (
    ManagedStorageItem,
    get_backup_storage_items,
    load_storage_layout,
)

BACKUP_MANIFEST_NAME = "manifest.json"
BACKUP_MANIFEST_VERSION = 3

# 滚动（轻量）备份时只复制的存储项 key，避免把大媒体目录反复整库复制。
ROLLING_BACKUP_ITEM_KEYS = ("database", "migration_state")


def _copy_item_to_backup(item: ManagedStorageItem, destination_root: Path) -> dict[str, Any]:
    source = item.absolute_path(APP_HOME)
    target = destination_root / item.relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    exists = source.exists()

    if exists:
        if item.kind == "directory":
            shutil.copytree(
                source,
                target,
                dirs_exist_ok=True,
                ignore=_ignore_nested_backups,
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
    }


def _ignore_nested_backups(current_dir: str, names: list[str]) -> set[str]:
    current_path = Path(current_dir).resolve()
    backups_path = BACKUPS_DIR.resolve()
    if current_path.name == backups_path.name:
        return set(names)
    if current_path == backups_path.parent and backups_path.name in names:
        return {backups_path.name}
    if current_path.name == "data" and backups_path.name in names:
        return {backups_path.name}
    return set()


def _select_backup_items(*, full: bool) -> list[ManagedStorageItem]:
    """根据备份范围挑选需要复制的存储项。

    full=True 复制全部 backup_items；full=False（滚动/轻量）只复制
    ROLLING_BACKUP_ITEM_KEYS 中的项（通常是数据库 + 迁移状态）。
    """
    all_items = get_backup_storage_items()
    if full:
        return list(all_items)
    rolling_keys = set(ROLLING_BACKUP_ITEM_KEYS)
    return [item for item in all_items if item.key in rolling_keys]


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
        "runtime_info": {
            "channel": runtime_info.get("channel"),
            "commit": runtime_info.get("commit"),
            "runtime_generation": runtime_info.get("runtime_generation"),
            "declared_runtime_generation": runtime_info.get("declared_runtime_generation"),
            "min_supported_generation": runtime_info.get("min_supported_generation"),
            "max_supported_generation": runtime_info.get("max_supported_generation"),
        },
        "included_items": included_items,
    }


def write_storage_backup(destination_root: Path, *, reason: str, full: bool = True) -> dict[str, Any]:
    ensure_runtime_dirs()
    destination_root.mkdir(parents=True, exist_ok=True)
    included_items = [
        _copy_item_to_backup(item, destination_root)
        for item in _select_backup_items(full=full)
    ]
    manifest = create_storage_backup_manifest(
        reason=reason, included_items=included_items, full=full
    )
    (destination_root / BACKUP_MANIFEST_NAME).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
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
    manifest = read_storage_backup_manifest(backup_root)
    manifest_items = manifest.get("included_items")
    if not isinstance(manifest_items, list):
        manifest_items = [
            {
                "key": item.key,
                "relative_path": item.relative_path,
                "kind": item.kind,
                "required": item.required,
                "source_exists": (backup_root / item.relative_path).exists(),
                "included": (backup_root / item.relative_path).exists(),
            }
            for item in get_backup_storage_items()
        ]

    restored_keys: list[str] = []
    for item in manifest_items:
        if not isinstance(item, dict):
            continue
        if not item.get("included"):
            continue
        relative_path = str(item.get("relative_path") or "").strip()
        kind = str(item.get("kind") or "")
        key = str(item.get("key") or relative_path)
        if not relative_path:
            continue
        source = backup_root / relative_path
        if not source.exists():
            continue
        destination = APP_HOME / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        if kind == "directory":
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)
        restored_keys.append(key)
    return restored_keys
