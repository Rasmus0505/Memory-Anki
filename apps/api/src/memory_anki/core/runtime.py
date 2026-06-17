from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from memory_anki.core.config import APP_HOME, APP_HOME_SOURCE, MIGRATION_STATE_PATH, REPO_ROOT
from memory_anki.core.runtime_activity import describe_active_runtime_instances
from memory_anki.core.storage_layout import load_storage_layout
from memory_anki.core.time import iso_utc_now

DEFAULT_RUNTIME_GENERATION = 1
RUNTIME_CONTRACT_PATH = REPO_ROOT / "apps" / "api" / "runtime-contract.json"
FRONTEND_ENTRY_PATTERN = re.compile(r'src="/assets/([^"]+\.js)"')


@dataclass(frozen=True, slots=True)
class RuntimeContract:
    runtime_generation: int
    min_supported_generation: int
    max_supported_generation: int
    contract_path: str


def _normalize_generation(value: Any, default: int = DEFAULT_RUNTIME_GENERATION) -> int:
    try:
        generation = int(value)
    except (TypeError, ValueError):
        return default
    return max(generation, 1)


def load_runtime_contract(path: Path | None = None) -> RuntimeContract:
    contract_path = Path(path) if path else RUNTIME_CONTRACT_PATH
    payload: dict[str, Any] = {}
    if contract_path.exists():
        try:
            parsed = json.loads(contract_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise RuntimeError(f"Failed to read runtime contract: {contract_path}") from exc
        if not isinstance(parsed, dict):
            raise RuntimeError(f"Invalid runtime contract format: {contract_path}")
        payload = parsed
    return RuntimeContract(
        runtime_generation=_normalize_generation(payload.get("runtime_generation")),
        min_supported_generation=_normalize_generation(payload.get("min_supported_generation")),
        max_supported_generation=_normalize_generation(payload.get("max_supported_generation")),
        contract_path=str(contract_path),
    )


def read_migration_state(path: Path | None = None) -> dict[str, Any]:
    state_path = Path(path) if path else MIGRATION_STATE_PATH
    if not state_path.exists():
        return {}
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def write_migration_state(payload: dict[str, Any], path: Path | None = None) -> None:
    state_path = Path(path) if path else MIGRATION_STATE_PATH
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def current_runtime_generation(state: dict[str, Any] | None = None) -> int:
    resolved_state = state if state is not None else read_migration_state()
    return _normalize_generation(resolved_state.get("runtime_generation"))


def detect_git_commit(repo_root: Path | None = None) -> str | None:
    try:
        output = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root or REPO_ROOT),
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except Exception:
        return None
    return output or None


def resolve_runtime_snapshot() -> str | None:
    snapshot = os.environ.get("MEMORY_ANKI_RUNTIME_SNAPSHOT")
    if not snapshot:
        return None
    return str(Path(snapshot))


def resolve_release_id(runtime_snapshot: str | None = None) -> str | None:
    snapshot = runtime_snapshot or resolve_runtime_snapshot()
    if not snapshot:
        return None
    name = Path(snapshot).name.strip()
    return name or None


def resolve_frontend_entry_asset(web_dist_dir: Path | None = None) -> str | None:
    configured_dir = web_dist_dir
    if configured_dir is None:
        raw_dir = os.environ.get("MEMORY_ANKI_WEB_DIST")
        if not raw_dir:
            return None
        configured_dir = Path(raw_dir)
    index_path = configured_dir / "index.html"
    if not index_path.exists():
        return None
    try:
        html = index_path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = FRONTEND_ENTRY_PATTERN.search(html)
    if not match:
        return None
    return match.group(1)


def resolve_frontend_bundle_hash(entry_asset: str | None) -> str | None:
    if not entry_asset:
        return None
    stem = Path(entry_asset).stem
    if "-" not in stem:
        return None
    return stem.rsplit("-", 1)[-1] or None


def assert_runtime_compatible(
    contract: RuntimeContract | None = None,
    state: dict[str, Any] | None = None,
    path: Path | None = None,
) -> dict[str, Any]:
    resolved_contract = contract or load_runtime_contract()
    shared_state = dict(state) if state is not None else read_migration_state(path)
    shared_generation = current_runtime_generation(shared_state)
    if shared_generation > resolved_contract.max_supported_generation:
        raise RuntimeError(
            "Shared data generation is newer than this version supports."
            f" Shared generation: {shared_generation}."
            f" Max supported generation: {resolved_contract.max_supported_generation}."
            " Start a newer app version, or restore a compatible backup before switching back."
        )
    if shared_generation < resolved_contract.min_supported_generation:
        raise RuntimeError(
            "Shared data generation is older than this version requires."
            f" Shared generation: {shared_generation}."
            f" Min required generation: {resolved_contract.min_supported_generation}."
            " Upgrade the shared data with a compatible app version first."
        )
    return shared_state


def record_runtime_start(
    contract: RuntimeContract | None = None,
    state: dict[str, Any] | None = None,
    channel: str | None = None,
    commit: str | None = None,
    path: Path | None = None,
) -> dict[str, Any]:
    resolved_contract = contract or load_runtime_contract()
    next_state = dict(state) if state is not None else read_migration_state(path)
    current_generation = current_runtime_generation(next_state)
    resolved_channel = channel or os.environ.get("MEMORY_ANKI_CHANNEL") or "production"
    resolved_commit = commit or os.environ.get("MEMORY_ANKI_GIT_COMMIT") or detect_git_commit()
    next_state["runtime_generation"] = max(
        current_generation,
        resolved_contract.runtime_generation,
    )
    next_state["last_started_channel"] = resolved_channel
    next_state["last_started_at"] = iso_utc_now()
    if resolved_commit:
        next_state["last_started_commit"] = resolved_commit
    next_state["runtime_contract"] = {
        "runtime_generation": resolved_contract.runtime_generation,
        "min_supported_generation": resolved_contract.min_supported_generation,
        "max_supported_generation": resolved_contract.max_supported_generation,
    }
    write_migration_state(next_state, path)
    return next_state


def build_runtime_info(
    contract: RuntimeContract | None = None,
    state: dict[str, Any] | None = None,
    channel: str | None = None,
    commit: str | None = None,
    path: Path | None = None,
) -> dict[str, Any]:
    resolved_contract = contract or load_runtime_contract()
    shared_state = dict(state) if state is not None else read_migration_state(path)
    resolved_channel = (
        channel
        or os.environ.get("MEMORY_ANKI_CHANNEL")
        or str(shared_state.get("last_started_channel") or "production")
    )
    resolved_commit = commit or os.environ.get("MEMORY_ANKI_GIT_COMMIT") or detect_git_commit()
    try:
        storage_layout = load_storage_layout()
        managed_storage_items = [
            {
                "key": item.key,
                "relative_path": item.relative_path,
                "kind": item.kind,
                "required": item.required,
                "absolute_path": str(item.absolute_path(APP_HOME)),
            }
            for item in storage_layout.managed_items
        ]
        backup_covered_items = [item.key for item in storage_layout.backup_items]
        storage_mode = storage_layout.storage_mode
    except OSError:
        managed_storage_items = []
        backup_covered_items = []
        storage_mode = "user_app_home"
    active_runtime_instances = describe_active_runtime_instances()
    runtime_snapshot = resolve_runtime_snapshot()
    release_id = resolve_release_id(runtime_snapshot)
    frontend_entry_asset = resolve_frontend_entry_asset()
    return {
        "channel": resolved_channel,
        "commit": resolved_commit,
        "short_commit": resolved_commit[:8] if resolved_commit else None,
        "runtime_generation": current_runtime_generation(shared_state),
        "declared_runtime_generation": resolved_contract.runtime_generation,
        "min_supported_generation": resolved_contract.min_supported_generation,
        "max_supported_generation": resolved_contract.max_supported_generation,
        "last_started_at": shared_state.get("last_started_at"),
        "app_home": str(APP_HOME),
        "app_home_source": APP_HOME_SOURCE,
        "runtime_snapshot": runtime_snapshot,
        "release_id": release_id,
        "frontend_entry_asset": frontend_entry_asset,
        "frontend_bundle_hash": resolve_frontend_bundle_hash(frontend_entry_asset),
        "storage_mode": storage_mode,
        "managed_storage_items": managed_storage_items,
        "backup_covered_items": backup_covered_items,
        "active_runtime_instances": active_runtime_instances,
    }


def build_runtime_health(
    *,
    state: dict[str, Any] | None = None,
    startup_mode: str | None = None,
    runtime_snapshot: str | None = None,
) -> dict[str, Any]:
    shared_state = dict(state) if state is not None else read_migration_state()
    resolved_snapshot = runtime_snapshot or resolve_runtime_snapshot()
    return {
        "ok": True,
        "startup_mode": str(startup_mode or os.environ.get("MEMORY_ANKI_STARTUP_MODE") or "serve"),
        "runtime_snapshot": resolved_snapshot,
        "release_id": resolve_release_id(resolved_snapshot),
        "started_at": shared_state.get("last_started_at"),
    }
