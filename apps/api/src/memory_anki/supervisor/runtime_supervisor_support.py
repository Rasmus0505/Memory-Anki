from __future__ import annotations

import json
import subprocess
import sys
import time
import uuid
import webbrowser
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

from memory_anki.core.config import APP_HOME, REPO_ROOT

SESSION_GRACE_SECONDS = 300
RETIRED_RELEASE_TTL_SECONDS = 900
SUPERVISOR_PORT = 8012
SUPERVISOR_HOST = "127.0.0.1"
INTERNAL_PORT_BASE = 18012
STATE_FILENAME = "supervisor-state.json"
POLL_INTERVAL_SECONDS = 2.0


@dataclass(slots=True)
class SupervisorConfig:
    repo_root: Path
    app_home: Path
    runtime_root: Path
    releases_root: Path
    logs_dir: Path
    state_path: Path
    host: str = SUPERVISOR_HOST
    port: int = SUPERVISOR_PORT
    internal_port_base: int = INTERNAL_PORT_BASE
    poll_interval_seconds: float = POLL_INTERVAL_SECONDS
    session_grace_seconds: int = SESSION_GRACE_SECONDS
    retired_release_ttl_seconds: int = RETIRED_RELEASE_TTL_SECONDS

    @property
    def browser_url(self) -> str:
        return f"http://{self.host}:{self.port}/"


@dataclass(slots=True)
class ReleaseRecord:
    release_id: str
    path: str
    fingerprint: str
    runtime_generation: int
    source_commit: str | None
    port: int | None = None
    process_id: int | None = None
    ready: bool = False
    created_at: float = field(default_factory=time.time)
    retired_at: float | None = None


def iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def build_supervisor_config() -> SupervisorConfig:
    runtime_root = APP_HOME / "runtime"
    return SupervisorConfig(
        repo_root=REPO_ROOT,
        app_home=APP_HOME,
        runtime_root=runtime_root,
        releases_root=runtime_root / "releases",
        logs_dir=APP_HOME / "logs",
        state_path=APP_HOME / STATE_FILENAME,
    )


def ensure_supervisor_directories(config: SupervisorConfig) -> None:
    for path in (config.app_home, config.runtime_root, config.releases_root, config.logs_dir):
        path.mkdir(parents=True, exist_ok=True)


def http_get_json(url: str, timeout: float = 2.0) -> dict[str, Any] | None:
    try:
        with urlopen(url, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
    except (URLError, OSError, TimeoutError):
        return None
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def is_supervisor_healthy(config: SupervisorConfig) -> bool:
    payload = http_get_json(f"{config.browser_url}__supervisor/health")
    return bool(payload and payload.get("ok"))


def open_browser(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:
        pass


def creation_flags() -> int:
    flags = 0
    for name in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
        flags |= int(getattr(subprocess, name, 0))
    return flags


def list_listening_pids(port: int) -> list[int]:
    try:
        output = subprocess.check_output(
            ["netstat", "-ano"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return []
    pids: list[int] = []
    for line in output.splitlines():
        if f":{port}" not in line or "LISTENING" not in line.upper():
            continue
        parts = [part for part in line.split() if part]
        if len(parts) < 5:
            continue
        try:
            pids.append(int(parts[-1]))
        except ValueError:
            continue
    return sorted(set(pid for pid in pids if pid > 0))


def kill_process_tree(pid: int) -> None:
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def wait_for_supervisor(config: SupervisorConfig, timeout_seconds: int = 120) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if is_supervisor_healthy(config):
            return
        time.sleep(0.5)
    raise TimeoutError("Timed out waiting for runtime supervisor.")


def ensure_background_supervisor(*, open_browser_after_launch: bool = True) -> SupervisorConfig:
    config = build_supervisor_config()
    ensure_supervisor_directories(config)
    if not is_supervisor_healthy(config):
        for pid in list_listening_pids(config.port):
            kill_process_tree(pid)
        time.sleep(0.5)
        log_path = config.logs_dir / "runtime-supervisor.log"
        with log_path.open("ab") as log_file:
            subprocess.Popen(
                [sys.executable, str(config.repo_root / "tools" / "runtime_supervisor.py"), "--serve"],
                cwd=str(config.repo_root),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=creation_flags(),
                close_fds=False,
            )
        wait_for_supervisor(config)
    if open_browser_after_launch:
        open_browser(config.browser_url)
    return config


def make_session_id() -> str:
    return uuid.uuid4().hex[:12]


def make_release_id() -> str:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{timestamp}-{uuid.uuid4().hex[:6]}"
