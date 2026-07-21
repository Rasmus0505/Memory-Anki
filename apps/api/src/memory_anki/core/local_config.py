from __future__ import annotations

import json
import os
import re
import socket
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory_anki.core.runtime_paths import default_app_home

REPO_ROOT = Path(__file__).resolve().parents[5]
LOCAL_CONFIG_DIR = REPO_ROOT / "local-config"
LOCAL_CONFIG_PATH = LOCAL_CONFIG_DIR / "memory-anki.local.json"
PLACEHOLDER_DEVICE_ID = "auto-generated-on-first-run"
SUPPORTED_CONFLICT_POLICY = "block"

_WINDOWS_ENV_PATTERN = re.compile(r"%([^%]+)%")
# vol:Label/relative/path — resolve removable/USB roots by volume label so drive
# letters can differ across Laptop/Desktop without hard-coding one machine.
_VOLUME_PATH_PATTERN = re.compile(
    r"^(?:vol|volume):(?P<label>[^/\\]+)[/\\]*(?P<rest>.*)$",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class LocalRuntimeConfig:
    device_id: str
    device_name: str
    local_app_home: Path
    sync_root: Path | None
    sync_enabled: bool
    conflict_policy: str
    sync_on_start: bool
    sync_on_stop: bool
    config_path: Path
    config_exists: bool


def _expand_env_vars(raw_value: str) -> str:
    def replace_windows_var(match: re.Match[str]) -> str:
        name = match.group(1)
        return os.environ.get(name, match.group(0))

    return os.path.expandvars(_WINDOWS_ENV_PATTERN.sub(replace_windows_var, raw_value))


def _windows_volume_root_by_label(label: str) -> Path | None:
    """Return the root path of the first Windows volume whose label matches."""
    if os.name != "nt":
        return None
    import ctypes

    wanted = label.strip().casefold()
    if not wanted:
        return None
    get_volume_information = ctypes.windll.kernel32.GetVolumeInformationW
    for code in range(ord("A"), ord("Z") + 1):
        root = f"{chr(code)}:\\"
        if not os.path.exists(root):
            continue
        volume_name = ctypes.create_unicode_buffer(261)
        ok = get_volume_information(
            ctypes.c_wchar_p(root),
            volume_name,
            261,
            None,
            None,
            None,
            None,
            0,
        )
        if ok and volume_name.value.casefold() == wanted:
            return Path(root)
    return None


def _resolve_volume_path(raw_value: str) -> Path | None:
    match = _VOLUME_PATH_PATTERN.match(raw_value.strip())
    if match is None:
        return None
    label = match.group("label").strip()
    rest = match.group("rest").strip().replace("/", os.sep).replace("\\", os.sep)
    root = _windows_volume_root_by_label(label)
    if root is None:
        raise RuntimeError(
            f"未找到卷标为「{label}」的磁盘（U 盘未插入、字母变化或卷标不符）。"
            f"请插入 U 盘并确认资源管理器中卷标为 {label}，"
            f"或把 local-config 里 local_app_home 改成实际盘符路径。"
        )
    return root / rest if rest else root


def _resolve_path(raw_value: Any, *, repo_root: Path, default: Path | None = None) -> Path | None:
    if raw_value is None or str(raw_value).strip() == "":
        return default
    expanded = _expand_env_vars(str(raw_value).strip())
    volume_path = _resolve_volume_path(expanded)
    if volume_path is not None:
        return volume_path
    path = Path(expanded).expanduser()
    if not path.is_absolute():
        path = repo_root / path
    return path


def _read_json(path: Path) -> dict[str, Any]:
    try:
        # utf-8-sig tolerates BOM written by some Windows editors / PowerShell.
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"本机配置文件不是有效 JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"本机配置文件必须是 JSON object: {path}")
    return payload


def _resolve_sync_root(sync_root: Path | None) -> Path | None:
    """Prefer an existing protocol layout under sync-meta when present.

    Historical Baidu layouts keep state.json + snapshots under ``sync-meta/``.
    If the configured path points at the parent folder (no state.json) but
    ``sync-meta/state.json`` exists, use that directory so both devices keep
    working without hand-editing paths.
    """
    if sync_root is None:
        return None
    if (sync_root / "state.json").exists():
        return sync_root
    nested = sync_root / "sync-meta"
    if (nested / "state.json").exists():
        return nested
    return sync_root


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_bool(payload: dict[str, Any], key: str, default: bool) -> bool:
    value = payload.get(key, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def load_local_runtime_config(
    *,
    config_path: Path | None = None,
    repo_root: Path | None = None,
    write_device_id: bool = True,
) -> LocalRuntimeConfig:
    resolved_repo = repo_root or REPO_ROOT
    resolved_path = config_path or LOCAL_CONFIG_PATH
    config_exists = resolved_path.exists()
    payload = _read_json(resolved_path) if config_exists else {}

    device_id = str(payload.get("device_id") or "").strip()
    should_persist_device_id = False
    if config_exists and (not device_id or device_id == PLACEHOLDER_DEVICE_ID):
        device_id = uuid.uuid4().hex
        should_persist_device_id = True
    elif not device_id:
        device_id = "unconfigured"

    if should_persist_device_id and write_device_id:
        next_payload = dict(payload)
        next_payload["device_id"] = device_id
        _write_json(resolved_path, next_payload)
        payload = next_payload

    device_name = str(payload.get("device_name") or socket.gethostname() or "Memory Anki").strip()
    local_app_home = _resolve_path(
        payload.get("local_app_home"),
        repo_root=resolved_repo,
        default=default_app_home(),
    )
    if local_app_home is None:
        local_app_home = default_app_home()
    sync_root = _resolve_sync_root(_resolve_path(payload.get("sync_root"), repo_root=resolved_repo))

    conflict_policy = str(payload.get("conflict_policy") or SUPPORTED_CONFLICT_POLICY).strip().lower()
    if conflict_policy != SUPPORTED_CONFLICT_POLICY:
        conflict_policy = SUPPORTED_CONFLICT_POLICY

    return LocalRuntimeConfig(
        device_id=device_id,
        device_name=device_name,
        local_app_home=local_app_home,
        sync_root=sync_root,
        sync_enabled=_normalize_bool(payload, "sync_enabled", False),
        conflict_policy=conflict_policy,
        sync_on_start=_normalize_bool(payload, "sync_on_start", True),
        sync_on_stop=_normalize_bool(payload, "sync_on_stop", True),
        config_path=resolved_path,
        config_exists=config_exists,
    )


__all__ = [
    "LOCAL_CONFIG_PATH",
    "LocalRuntimeConfig",
    "PLACEHOLDER_DEVICE_ID",
    "default_app_home",
    "load_local_runtime_config",
]
