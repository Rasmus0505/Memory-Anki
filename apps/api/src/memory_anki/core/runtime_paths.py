from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
APP_HOME_ENV = "MEMORY_ANKI_HOME"
APP_HOME_DIR_NAME = "MemoryAnki"


@dataclass(frozen=True, slots=True)
class AppHomeResolution:
    app_home: Path
    source: str


def _expand_path(value: str) -> Path:
    return Path(os.path.expandvars(value)).expanduser()


def default_app_home() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return _expand_path(local_app_data) / APP_HOME_DIR_NAME

    app_data = os.environ.get("APPDATA")
    if app_data:
        return _expand_path(app_data) / APP_HOME_DIR_NAME

    return Path.home() / ".memory-anki"


def resolve_app_home() -> AppHomeResolution:
    configured = os.environ.get(APP_HOME_ENV)
    if configured and configured.strip():
        return AppHomeResolution(_expand_path(configured.strip()), "env")
    return AppHomeResolution(default_app_home(), "default")


def get_app_home() -> Path:
    return resolve_app_home().app_home


__all__ = [
    "APP_HOME_ENV",
    "AppHomeResolution",
    "REPO_ROOT",
    "default_app_home",
    "get_app_home",
    "resolve_app_home",
]
