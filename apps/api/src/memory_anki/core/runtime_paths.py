from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
APP_NAME = "MemoryAnki"


@dataclass(frozen=True, slots=True)
class RuntimePathResolution:
    app_home: Path
    source: str


def default_app_home() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / APP_NAME
    return Path.home() / "AppData" / "Local" / APP_NAME


def resolve_app_home() -> RuntimePathResolution:
    explicit_home = os.environ.get("MEMORY_ANKI_HOME")
    if explicit_home:
        return RuntimePathResolution(Path(explicit_home).expanduser(), "env")
    return RuntimePathResolution(default_app_home(), "default")


def get_app_home() -> Path:
    return resolve_app_home().app_home

