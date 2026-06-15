from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from dataclasses import asdict, dataclass, field
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

from memory_anki.core.config import APP_HOME, REPO_ROOT
from memory_anki.core.runtime import detect_git_commit

COOKIE_NAME = "memory_anki_release"
SESSION_GRACE_SECONDS = 300
RETIRED_RELEASE_TTL_SECONDS = 900
SUPERVISOR_PORT = 8012
SUPERVISOR_HOST = "127.0.0.1"
INTERNAL_PORT_BASE = 18012
STATE_FILENAME = "supervisor-state.json"
POLL_INTERVAL_SECONDS = 2.0
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
SOURCE_FINGERPRINT_PATHS = (
    "apps/api/src",
    "apps/api/alembic",
    "apps/api/pyproject.toml",
    "apps/api/requirements.txt",
    "apps/api/runtime-contract.json",
    "apps/api/storage-layout.json",
    "apps/api/alembic.ini",
    "apps/web/src",
    "apps/web/public",
    "apps/web/index.html",
    "apps/web/package.json",
    "apps/web/package-lock.json",
    "apps/web/tsconfig.json",
    "apps/web/tsconfig.app.json",
    "apps/web/tsconfig.node.json",
    "apps/web/vite.config.ts",
    "start.bat",
)
IGNORE_PARTS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "runtime-data",
}


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


def _iso_now() -> str:
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


def _ensure_directories(config: SupervisorConfig) -> None:
    for path in (config.app_home, config.runtime_root, config.releases_root, config.logs_dir):
        path.mkdir(parents=True, exist_ok=True)


def _http_get_json(url: str, timeout: float = 2.0) -> dict[str, Any] | None:
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
    payload = _http_get_json(f"{config.browser_url}__supervisor/health")
    return bool(payload and payload.get("ok"))


def _open_browser(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:
        pass


def _creation_flags() -> int:
    flags = 0
    for name in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
        flags |= int(getattr(subprocess, name, 0))
    return flags


def _listening_pids(port: int) -> list[int]:
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


def _kill_process_tree(pid: int) -> None:
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


def ensure_background_supervisor(*, open_browser: bool = True) -> SupervisorConfig:
    config = build_supervisor_config()
    _ensure_directories(config)
    if not is_supervisor_healthy(config):
        for pid in _listening_pids(config.port):
            _kill_process_tree(pid)
        time.sleep(0.5)
        log_path = config.logs_dir / "runtime-supervisor.log"
        with log_path.open("ab") as log_file:
            subprocess.Popen(
                [sys.executable, str(config.repo_root / "tools" / "runtime_supervisor.py"), "--serve"],
                cwd=str(config.repo_root),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=_creation_flags(),
                close_fds=False,
            )
        wait_for_supervisor(config)
    if open_browser:
        _open_browser(config.browser_url)
    return config


class RuntimeSupervisor:
    def __init__(self, config: SupervisorConfig) -> None:
        self.config = config
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.releases: dict[str, ReleaseRecord] = {}
        self.release_processes: dict[str, subprocess.Popen[bytes]] = {}
        self.release_sessions: dict[str, dict[str, float]] = {}
        self.current_release_id: str | None = None
        self.candidate_release_id: str | None = None
        self.last_repo_fingerprint: str = ""
        self.last_publish_error: str | None = None
        self.last_blocked_fingerprint: str | None = None
        self.building = False
        self.server: ThreadingHTTPServer | None = None

    def load_state(self) -> None:
        if not self.config.state_path.exists():
            return
        try:
            payload = json.loads(self.config.state_path.read_text(encoding="utf-8"))
        except Exception:
            return
        if not isinstance(payload, dict):
            return
        self.current_release_id = str(payload.get("current_release_id") or "") or None
        self.candidate_release_id = str(payload.get("candidate_release_id") or "") or None
        self.last_repo_fingerprint = str(payload.get("last_repo_fingerprint") or "")
        self.last_publish_error = str(payload.get("last_publish_error") or "") or None
        releases = payload.get("releases")
        if isinstance(releases, list):
            for item in releases:
                if not isinstance(item, dict):
                    continue
                release_id = str(item.get("release_id") or "").strip()
                if not release_id:
                    continue
                self.releases[release_id] = ReleaseRecord(
                    release_id=release_id,
                    path=str(item.get("path") or ""),
                    fingerprint=str(item.get("fingerprint") or ""),
                    runtime_generation=int(item.get("runtime_generation") or 1),
                    source_commit=str(item.get("source_commit") or "") or None,
                    ready=bool(item.get("ready")),
                    created_at=float(item.get("created_at") or time.time()),
                    retired_at=float(item["retired_at"]) if item.get("retired_at") else None,
                )

    def save_state(self) -> None:
        payload = {
            "version": 1,
            "saved_at": _iso_now(),
            "current_release_id": self.current_release_id,
            "candidate_release_id": self.candidate_release_id,
            "last_repo_fingerprint": self.last_repo_fingerprint,
            "last_publish_error": self.last_publish_error,
            "releases": [asdict(release) for release in self.releases.values()],
        }
        self.config.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.config.state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _release_metadata_path(self, release_dir: Path) -> Path:
        return release_dir / "release-metadata.json"

    def _compute_source_fingerprint(self) -> str:
        digest = hashlib.sha256()
        for relative_path in SOURCE_FINGERPRINT_PATHS:
            target = self.config.repo_root / relative_path
            if not target.exists():
                digest.update(f"missing:{relative_path}\n".encode())
                continue
            if target.is_file():
                stat = target.stat()
                digest.update(f"file:{relative_path}:{stat.st_mtime_ns}:{stat.st_size}\n".encode())
                continue
            for child in sorted(target.rglob("*")):
                if any(part in IGNORE_PARTS for part in child.parts):
                    continue
                if not child.is_file():
                    continue
                relative_child = child.relative_to(self.config.repo_root).as_posix()
                stat = child.stat()
                digest.update(f"file:{relative_child}:{stat.st_mtime_ns}:{stat.st_size}\n".encode())
        return digest.hexdigest()

    def _load_runtime_generation(self, root: Path) -> int:
        contract_path = root / "apps" / "api" / "runtime-contract.json"
        if not contract_path.exists():
            return 1
        try:
            payload = json.loads(contract_path.read_text(encoding="utf-8"))
        except Exception:
            return 1
        return max(1, int(payload.get("runtime_generation") or 1))

    def _release_is_compatible(self, next_generation: int) -> bool:
        current = self.releases.get(self.current_release_id or "")
        if current is None:
            return True
        return current.runtime_generation == next_generation

    def _copy_release_tree(self, source: Path, destination: Path) -> None:
        if not source.exists():
            raise FileNotFoundError(f"Missing required path: {source}")
        shutil.copytree(source, destination)

    def _run_logged_command(
        self,
        *,
        command: list[str],
        cwd: Path,
        env: dict[str, str],
        log_name: str,
    ) -> None:
        log_path = self.config.logs_dir / log_name
        with log_path.open("ab") as log_file:
            result = subprocess.run(
                command,
                cwd=str(cwd),
                env=env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                check=False,
            )
        if result.returncode != 0:
            raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command)}")

    def _find_free_port(self) -> int:
        used_ports = {release.port for release in self.releases.values() if release.port}
        for offset in range(0, 200):
            port = self.config.internal_port_base + offset
            if port in used_ports:
                continue
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                if sock.connect_ex((self.config.host, port)) != 0:
                    return port
        raise RuntimeError("No free internal backend port available.")

    def _stop_release_process(self, release_id: str) -> None:
        process = self.release_processes.pop(release_id, None)
        if process is None:
            return
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            try:
                process.kill()
            except Exception:
                pass
        try:
            process.wait(timeout=5)
        except Exception:
            pass
        release = self.releases.get(release_id)
        if release:
            release.process_id = None
            release.port = None
            release.ready = False

    def _snapshot_release(self, release_dir: Path) -> None:
        api_source = self.config.repo_root / "apps" / "api"
        web_source = self.config.repo_root / "apps" / "web" / "dist"
        api_destination = release_dir / "apps" / "api"
        web_destination = release_dir / "apps" / "web" / "dist"
        if release_dir.exists():
            shutil.rmtree(release_dir)
        release_dir.mkdir(parents=True, exist_ok=True)
        self._copy_release_tree(api_source / "src", api_destination / "src")
        self._copy_release_tree(api_source / "alembic", api_destination / "alembic")
        self._copy_release_tree(web_source, web_destination)
        for file_name in (
            "pyproject.toml",
            "requirements.txt",
            "runtime-contract.json",
            "storage-layout.json",
            "alembic.ini",
        ):
            source_file = api_source / file_name
            if source_file.exists():
                shutil.copy2(source_file, api_destination / file_name)

    def _prepare_release(self, release_dir: Path, release_id: str) -> None:
        env = os.environ.copy()
        env["MEMORY_ANKI_HOME"] = str(self.config.app_home)
        env["PYTHONPATH"] = "src"
        env["MEMORY_ANKI_STARTUP_MODE"] = "prepare"
        self._run_logged_command(
            command=[sys.executable, "-m", "memory_anki.app.runtime_prepare"],
            cwd=release_dir / "apps" / "api",
            env=env,
            log_name=f"{release_id}-prepare.log",
        )

    def _start_release_backend(self, release: ReleaseRecord) -> None:
        port = self._find_free_port()
        api_dir = Path(release.path) / "apps" / "api"
        api_log = self.config.logs_dir / f"{release.release_id}-api.log"
        with api_log.open("ab") as log_file:
            env = os.environ.copy()
            env["MEMORY_ANKI_HOME"] = str(self.config.app_home)
            env["MEMORY_ANKI_CHANNEL"] = "production"
            env["MEMORY_ANKI_WEB_DIST"] = str(Path(release.path) / "apps" / "web" / "dist")
            env["MEMORY_ANKI_RUNTIME_SNAPSHOT"] = str(release.path)
            env["MEMORY_ANKI_STARTUP_MODE"] = "serve"
            commit = detect_git_commit(self.config.repo_root)
            if commit:
                env["MEMORY_ANKI_GIT_COMMIT"] = commit
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "--app-dir",
                    "src",
                    "memory_anki.app.main:app",
                    "--host",
                    self.config.host,
                    "--port",
                    str(port),
                ],
                cwd=str(api_dir),
                env=env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=_creation_flags(),
                close_fds=False,
            )
        release.port = port
        release.process_id = process.pid
        self.release_processes[release.release_id] = process

    def _wait_for_backend_health(self, release: ReleaseRecord, timeout_seconds: int = 90) -> None:
        deadline = time.time() + timeout_seconds
        url = f"http://{self.config.host}:{release.port}/api/v1/runtime-health"
        while time.time() < deadline:
            payload = _http_get_json(url)
            if payload and payload.get("ok"):
                release.ready = True
                return
            process = self.release_processes.get(release.release_id)
            if process and process.poll() is not None:
                raise RuntimeError(f"Backend exited before healthcheck for release {release.release_id}.")
            time.sleep(0.5)
        raise TimeoutError(f"Timed out waiting for backend health: {release.release_id}")

    def _publish_release(self, *, promote_immediately: bool) -> ReleaseRecord:
        release_id = datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{uuid.uuid4().hex[:6]}"
        fingerprint = self._compute_source_fingerprint()
        runtime_generation = self._load_runtime_generation(self.config.repo_root)
        if not self._release_is_compatible(runtime_generation):
            self.last_publish_error = (
                "Detected runtime generation change. Automatic hot publish is blocked until a manual maintenance release."
            )
            self.last_blocked_fingerprint = fingerprint
            raise RuntimeError(self.last_publish_error)

        self.last_publish_error = None
        web_env = os.environ.copy()
        web_env["MEMORY_ANKI_HOME"] = str(self.config.app_home)
        self._run_logged_command(
            command=["npm.cmd", "run", "build"],
            cwd=self.config.repo_root / "apps" / "web",
            env=web_env,
            log_name=f"{release_id}-web-build.log",
        )

        release_dir = self.config.releases_root / release_id
        self._snapshot_release(release_dir)
        self._prepare_release(release_dir, release_id)
        release = ReleaseRecord(
            release_id=release_id,
            path=str(release_dir),
            fingerprint=fingerprint,
            runtime_generation=runtime_generation,
            source_commit=detect_git_commit(self.config.repo_root),
            ready=False,
        )
        metadata_path = self._release_metadata_path(release_dir)
        metadata_path.write_text(
            json.dumps(
                {
                    "release_id": release.release_id,
                    "fingerprint": release.fingerprint,
                    "runtime_generation": release.runtime_generation,
                    "source_commit": release.source_commit,
                    "created_at": _iso_now(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self._start_release_backend(release)
        self._wait_for_backend_health(release)

        with self.lock:
            existing_candidate_id = self.candidate_release_id
            if existing_candidate_id and existing_candidate_id in self.releases:
                self._stop_release_process(existing_candidate_id)
                old_candidate = self.releases.pop(existing_candidate_id, None)
                if old_candidate:
                    shutil.rmtree(old_candidate.path, ignore_errors=True)
                self.release_sessions.pop(existing_candidate_id, None)
            self.releases[release.release_id] = release
            self.release_sessions.setdefault(release.release_id, {})
            self.last_repo_fingerprint = fingerprint
            if promote_immediately or self.current_release_id is None:
                previous_release_id = self.current_release_id
                self.current_release_id = release.release_id
                self.candidate_release_id = None
                if previous_release_id and previous_release_id in self.releases:
                    self.releases[previous_release_id].retired_at = time.time()
            else:
                self.candidate_release_id = release.release_id
            self.save_state()
        return release

    def _restore_saved_release(self, release_id: str | None) -> bool:
        if not release_id:
            return False
        release = self.releases.get(release_id)
        if not release:
            return False
        release_path = Path(release.path)
        if not release_path.exists():
            return False
        try:
            self._start_release_backend(release)
            self._wait_for_backend_health(release, timeout_seconds=30)
        except Exception:
            self._stop_release_process(release_id)
            return False
        self.release_sessions.setdefault(release_id, {})
        return True

    def _drop_candidate_release(self) -> None:
        candidate_id = self.candidate_release_id
        if not candidate_id:
            return
        self._stop_release_process(candidate_id)
        release = self.releases.pop(candidate_id, None)
        self.release_sessions.pop(candidate_id, None)
        self.candidate_release_id = None
        current = self.releases.get(self.current_release_id or "")
        self.last_repo_fingerprint = current.fingerprint if current else ""
        if release:
            shutil.rmtree(release.path, ignore_errors=True)
        self.save_state()

    def _candidate_is_routable_locked(self) -> bool:
        if not self.candidate_release_id:
            return False
        candidate = self.releases.get(self.candidate_release_id)
        return bool(candidate and candidate.ready and candidate.port)

    def _send_text_response(
        self,
        handler: BaseHTTPRequestHandler,
        status_code: int,
        message: str,
    ) -> None:
        body = message.encode("utf-8", errors="replace")
        handler.send_response(status_code)
        handler.send_header("Content-Type", "text/plain; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        if handler.command == "HEAD":
            return
        try:
            handler.wfile.write(body)
        except Exception:
            pass

    def _publish_worker(self, *, promote_immediately: bool) -> None:
        try:
            self._publish_release(promote_immediately=promote_immediately)
        except Exception as exc:
            with self.lock:
                self.last_publish_error = str(exc)
                self.save_state()
        finally:
            with self.lock:
                self.building = False

    def trigger_publish(self, *, promote_immediately: bool = False) -> None:
        with self.lock:
            if self.building:
                return
            self.building = True
        thread = threading.Thread(
            target=self._publish_worker,
            kwargs={"promote_immediately": promote_immediately},
            name="memory-anki-release-build",
            daemon=True,
        )
        thread.start()

    def _watch_loop(self) -> None:
        while not self.stop_event.wait(self.config.poll_interval_seconds):
            fingerprint = self._compute_source_fingerprint()
            with self.lock:
                if fingerprint == self.last_repo_fingerprint:
                    pass
                elif fingerprint == self.last_blocked_fingerprint:
                    pass
                elif not self.building:
                    self.building = True
                    threading.Thread(
                        target=self._publish_worker,
                        kwargs={"promote_immediately": False},
                        name="memory-anki-release-watch-build",
                        daemon=True,
                    ).start()
            self._cleanup_releases()

    def _cleanup_releases(self) -> None:
        now = time.time()
        with self.lock:
            removable: list[str] = []
            for release_id, release in self.releases.items():
                if release_id in {self.current_release_id, self.candidate_release_id}:
                    continue
                if release.retired_at is None:
                    continue
                sessions = self.release_sessions.get(release_id, {})
                sessions = {
                    session_key: last_seen
                    for session_key, last_seen in sessions.items()
                    if now - last_seen <= self.config.session_grace_seconds
                }
                self.release_sessions[release_id] = sessions
                should_remove = not sessions and now - release.retired_at >= self.config.retired_release_ttl_seconds
                if should_remove:
                    removable.append(release_id)
            for release_id in removable:
                self._stop_release_process(release_id)
                release = self.releases.pop(release_id, None)
                self.release_sessions.pop(release_id, None)
                if release:
                    shutil.rmtree(release.path, ignore_errors=True)
            if removable:
                self.save_state()

    def _promote_candidate_locked(self) -> str | None:
        candidate_id = self.candidate_release_id
        if not candidate_id:
            return self.current_release_id
        previous_release_id = self.current_release_id
        self.current_release_id = candidate_id
        self.candidate_release_id = None
        if previous_release_id and previous_release_id in self.releases:
            self.releases[previous_release_id].retired_at = time.time()
        self.save_state()
        return candidate_id

    def _parse_cookie(self, raw_cookie: str | None) -> tuple[str | None, str | None]:
        if not raw_cookie:
            return None, None
        try:
            cookie = SimpleCookie(raw_cookie)
        except Exception:
            return None, None
        morsel = cookie.get(COOKIE_NAME)
        if morsel is None:
            return None, None
        value = morsel.value
        if "." not in value:
            return None, None
        release_id, session_id = value.split(".", 1)
        return release_id or None, session_id or None

    def _make_cookie_value(self, release_id: str) -> tuple[str, str]:
        session_id = uuid.uuid4().hex[:12]
        return session_id, f"{release_id}.{session_id}"

    def _is_document_request(self, handler: BaseHTTPRequestHandler) -> bool:
        if handler.command not in {"GET", "HEAD"}:
            return False
        path = handler.path.split("?", 1)[0]
        if path.startswith("/api") or path.startswith("/__supervisor"):
            return False
        if path in {"/", ""}:
            return True
        if "." in Path(path).name:
            return False
        accept = str(handler.headers.get("Accept") or "")
        return "text/html" in accept or "*/*" in accept

    def _select_release_for_request(
        self,
        handler: BaseHTTPRequestHandler,
    ) -> tuple[ReleaseRecord, str | None]:
        request_release_id, session_id = self._parse_cookie(handler.headers.get("Cookie"))
        with self.lock:
            if not self.current_release_id or self.current_release_id not in self.releases:
                raise RuntimeError("No active release is available.")
            set_cookie_header: str | None = None
            target_release_id = self.current_release_id
            if self._is_document_request(handler):
                if self._candidate_is_routable_locked():
                    promoted_release_id = self._promote_candidate_locked()
                    if promoted_release_id:
                        target_release_id = promoted_release_id
                    session_id, cookie_value = self._make_cookie_value(target_release_id)
                    set_cookie_header = f"{COOKIE_NAME}={cookie_value}; Path=/; HttpOnly; SameSite=Lax"
                elif request_release_id in self.releases and session_id:
                    target_release_id = request_release_id
                else:
                    session_id, cookie_value = self._make_cookie_value(target_release_id)
                    set_cookie_header = f"{COOKIE_NAME}={cookie_value}; Path=/; HttpOnly; SameSite=Lax"
            elif request_release_id in self.releases and session_id:
                target_release_id = request_release_id
            release = self.releases[target_release_id]
            if session_id:
                self.release_sessions.setdefault(target_release_id, {})[session_id] = time.time()
            return release, set_cookie_header

    def _supervisor_status(self) -> dict[str, Any]:
        with self.lock:
            return {
                "ok": True,
                "current_release_id": self.current_release_id,
                "candidate_release_id": self.candidate_release_id,
                "building": self.building,
                "last_publish_error": self.last_publish_error,
                "releases": [
                    {
                        "release_id": release.release_id,
                        "ready": release.ready,
                        "port": release.port,
                        "retired_at": release.retired_at,
                    }
                    for release in self.releases.values()
                ],
            }

    def _proxy_request(self, handler: BaseHTTPRequestHandler) -> None:
        try:
            release, set_cookie_header = self._select_release_for_request(handler)
        except Exception as exc:
            self._send_text_response(handler, 503, str(exc))
            return

        content_length = int(handler.headers.get("Content-Length") or "0")
        body = handler.rfile.read(content_length) if content_length > 0 else None
        headers = {
            key: value
            for key, value in handler.headers.items()
            if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "host"
        }
        headers["Host"] = f"{self.config.host}:{release.port}"
        connection = http.client.HTTPConnection(self.config.host, release.port, timeout=120)
        try:
            connection.request(handler.command, handler.path, body=body, headers=headers)
            response = connection.getresponse()
            handler.send_response(response.status, response.reason)
            for header, value in response.getheaders():
                if header.lower() in HOP_BY_HOP_HEADERS:
                    continue
                handler.send_header(header, value)
            if set_cookie_header:
                handler.send_header("Set-Cookie", set_cookie_header)
            handler.end_headers()
            if handler.command != "HEAD":
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    handler.wfile.write(chunk)
        except Exception as exc:
            self._send_text_response(handler, 502, f"Proxy error: {exc}")
        finally:
            try:
                connection.close()
            except Exception:
                pass

    def make_handler(self):
        supervisor = self

        class SupervisorHandler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                if self.path.startswith("/__supervisor/health"):
                    payload = supervisor._supervisor_status()
                    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                supervisor._proxy_request(self)

            def do_HEAD(self):  # noqa: N802
                if self.path.startswith("/__supervisor/health"):
                    payload = supervisor._supervisor_status()
                    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    return
                supervisor._proxy_request(self)

            def do_POST(self):  # noqa: N802
                supervisor._proxy_request(self)

            def do_PUT(self):  # noqa: N802
                supervisor._proxy_request(self)

            def do_PATCH(self):  # noqa: N802
                supervisor._proxy_request(self)

            def do_DELETE(self):  # noqa: N802
                supervisor._proxy_request(self)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

        return SupervisorHandler

    def start(self) -> None:
        _ensure_directories(self.config)
        self.load_state()
        restored = self._restore_saved_release(self.current_release_id)
        if restored and self.candidate_release_id:
            candidate_restored = self._restore_saved_release(self.candidate_release_id)
            with self.lock:
                if not candidate_restored:
                    self._drop_candidate_release()
        if not restored:
            self.trigger_publish(promote_immediately=True)
            while True:
                with self.lock:
                    ready = bool(self.current_release_id and self.current_release_id in self.releases)
                    building = self.building
                    error = self.last_publish_error
                if ready and not building:
                    break
                if error and not building:
                    raise RuntimeError(error)
                time.sleep(0.5)

        repo_fingerprint = self._compute_source_fingerprint()
        with self.lock:
            if not self.last_repo_fingerprint:
                self.last_repo_fingerprint = repo_fingerprint
                self.save_state()
            elif repo_fingerprint != self.last_repo_fingerprint and not self.building:
                self.building = True
                threading.Thread(
                    target=self._publish_worker,
                    kwargs={"promote_immediately": False},
                    daemon=True,
                    name="memory-anki-startup-candidate-build",
                ).start()

        watcher = threading.Thread(target=self._watch_loop, daemon=True, name="memory-anki-supervisor-watch")
        watcher.start()
        self.server = ThreadingHTTPServer((self.config.host, self.config.port), self.make_handler())
        try:
            self.server.serve_forever(poll_interval=0.5)
        finally:
            self.stop_event.set()
            self.shutdown()

    def shutdown(self) -> None:
        if self.server:
            try:
                self.server.server_close()
            except Exception:
                pass
        with self.lock:
            release_ids = list(self.release_processes.keys())
        for release_id in release_ids:
            self._stop_release_process(release_id)
        self.save_state()


def serve_supervisor() -> int:
    config = build_supervisor_config()
    supervisor = RuntimeSupervisor(config)
    supervisor.start()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Memory Anki runtime supervisor")
    parser.add_argument("--serve", action="store_true", help="Run the supervisor in the foreground.")
    parser.add_argument("--launch", action="store_true", help="Ensure the background supervisor is running.")
    args = parser.parse_args(argv)
    if args.launch:
        ensure_background_supervisor(open_browser=True)
        return 0
    if args.serve:
        return serve_supervisor()
    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
