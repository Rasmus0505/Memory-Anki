from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]

STORAGE_LAYOUT_PATH = REPO_ROOT / "apps" / "api" / "storage-layout.json"


def resolve_app_home() -> Path:
    explicit_home = os.environ.get("MEMORY_ANKI_HOME")
    if explicit_home:
        return Path(explicit_home)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "MemoryAnki"
    return Path.home() / "AppData" / "Local" / "MemoryAnki"


@dataclass(frozen=True, slots=True)
class ManagedStorageItem:
    key: str
    relative_path: str
    kind: str
    required: bool
    backup: bool

    def absolute_path(self, app_home: Path | None = None) -> Path:
        return (app_home or resolve_app_home()) / self.relative_path


@dataclass(frozen=True, slots=True)
class StorageLayout:
    storage_mode: str
    managed_items: tuple[ManagedStorageItem, ...]
    source_path: str

    @property
    def backup_items(self) -> tuple[ManagedStorageItem, ...]:
        return tuple(item for item in self.managed_items if item.backup)


def load_storage_layout(path: Path | None = None) -> StorageLayout:
    layout_path = Path(path) if path else STORAGE_LAYOUT_PATH
    payload = json.loads(layout_path.read_text(encoding="utf-8"))
    items = tuple(
        ManagedStorageItem(
            key=str(item["key"]),
            relative_path=str(item["relative_path"]),
            kind=str(item["kind"]),
            required=bool(item.get("required", False)),
            backup=bool(item.get("backup", False)),
        )
        for item in payload.get("managed_items", [])
        if isinstance(item, dict)
    )
    return StorageLayout(
        storage_mode=str(payload.get("storage_mode") or "user_app_home"),
        managed_items=items,
        source_path=str(layout_path),
    )


def get_managed_storage_items(path: Path | None = None) -> tuple[ManagedStorageItem, ...]:
    return load_storage_layout(path).managed_items


def get_backup_storage_items(path: Path | None = None) -> tuple[ManagedStorageItem, ...]:
    return load_storage_layout(path).backup_items
