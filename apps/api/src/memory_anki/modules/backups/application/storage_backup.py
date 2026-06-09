from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from memory_anki.core.config import APP_HOME, ensure_runtime_dirs
from memory_anki.core.runtime import build_runtime_info
from memory_anki.core.storage_layout import (
    ManagedStorageItem,
    get_backup_storage_items,
    load_storage_layout,
)

BACKUP_MANIFEST_NAME = "manifest.json"
BACKUP_MANIFEST_VERSION = 2


def _copy_item_to_backup(item: ManagedStorageItem, destination_root: Path) -> dict[str, Any]:
    source = item.absolute_path(APP_HOME)
    target = destination_root / item.relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    exists = source.exists()

    if exists:
        if item.kind == "directory":
            shutil.copytree(source, target, dirs_exist_ok=True)
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


def create_storage_backup_manifest(*, reason: str, included_items: list[dict[str, Any]]) -> dict[str, Any]:
    runtime_info = build_runtime_info()
    return {
        "version": BACKUP_MANIFEST_VERSION,
        "reason": reason,
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


def write_storage_backup(destination_root: Path, *, reason: str) -> dict[str, Any]:
    ensure_runtime_dirs()
    destination_root.mkdir(parents=True, exist_ok=True)
    included_items = [
        _copy_item_to_backup(item, destination_root)
        for item in get_backup_storage_items()
    ]
    manifest = create_storage_backup_manifest(reason=reason, included_items=included_items)
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
