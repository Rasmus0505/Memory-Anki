from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from dataclasses import asdict
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

from memory_anki.core.runtime import detect_git_commit
from memory_anki.core.runtime_activity import list_active_runtime_instances
from memory_anki.supervisor import runtime_supervisor_lifecycle as supervisor_lifecycle
from memory_anki.supervisor import runtime_supervisor_proxy as supervisor_proxy
from memory_anki.supervisor.runtime_supervisor_support import (
    INTERNAL_PORT_BASE,
    POLL_INTERVAL_SECONDS,
    RUN_MODE_SUPERVISOR,
    RETIRED_RELEASE_TTL_SECONDS,
    SESSION_GRACE_SECONDS,
    SUPERVISOR_HOST,
    SUPERVISOR_PORT,
    ReleaseRecord,
    SupervisorConfig,
    build_hidden_process_kwargs,
    build_supervisor_config,
    ensure_background_supervisor,
    ensure_latest_workspace_runtime,
    http_get_json,
    is_supervisor_healthy,
    iso_now,
    kill_process_tree,
    list_listening_pids,
    make_release_id,
    resolve_runtime_run_mode,
    wait_for_supervisor,
)

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


class RuntimeSupervisor:
    def __init__(self, config: SupervisorConfig) -> None:
        self.config = config
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.releases: dict[str, ReleaseRecord] = {}
        self.release_processes: dict[str, subprocess.Popen[bytes]] = {}
        self.release_sessions: dict[str, dict[str, float]] = {}
        self.pending_release_ids: set[str] = set()
        self.current_release_id: str | None = None
        self.candidate_release_id: str | None = None
        self.last_repo_fingerprint: str = ""
        self.last_publish_error: str | None = None
        self.last_blocked_fingerprint: str | None = None
        self.last_failed_fingerprint: str | None = None
        self.last_successful_release_id: str | None = None
        self.build_started_at: float | None = None
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
        self.last_failed_fingerprint = str(payload.get("last_failed_fingerprint") or "") or None
        self.last_successful_release_id = str(payload.get("last_successful_release_id") or "") or self.current_release_id
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
                    port=int(item.get("port")) if item.get("port") is not None else None,
                    process_id=int(item.get("process_id")) if item.get("process_id") is not None else None,
                    ready=bool(item.get("ready")),
                    created_at=float(item.get("created_at") or time.time()),
                    retired_at=float(item["retired_at"]) if item.get("retired_at") else None,
                )

    def save_state(self) -> None:
        payload = {
            "version": 1,
            "saved_at": iso_now(),
            "current_release_id": self.current_release_id,
            "candidate_release_id": self.candidate_release_id,
            "last_repo_fingerprint": self.last_repo_fingerprint,
            "last_publish_error": self.last_publish_error,
            "last_failed_fingerprint": self.last_failed_fingerprint,
            "last_successful_release_id": self.last_successful_release_id,
            "releases": [asdict(release) for release in self.releases.values()],
        }
        self.config.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.config.state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _release_metadata_path(self, release_dir: Path) -> Path:
        return release_dir / "release-metadata.json"

    def _set_building_locked(self, value: bool) -> None:
        if value:
            if not self.building or self.build_started_at is None:
                self.build_started_at = time.time()
            self.building = True
            return
        self.building = False
        self.build_started_at = None

    def _serialize_timestamp(self, timestamp: float | None) -> str | None:
        if timestamp is None:
            return None
        return datetime.fromtimestamp(timestamp).isoformat(timespec="seconds")

    def _delete_release_directory(self, release_path: str | None) -> None:
        if not release_path:
            return
        shutil.rmtree(release_path, ignore_errors=True)

    def _discard_release(
        self,
        release_id: str,
        *,
        clear_candidate: bool = False,
        clear_current: bool = False,
        remove_dir: bool = True,
    ) -> None:
        self._stop_release_process(release_id)
        release_path: str | None = None
        with self.lock:
            release = self.releases.pop(release_id, None)
            self.release_sessions.pop(release_id, None)
            if clear_candidate and self.candidate_release_id == release_id:
                self.candidate_release_id = None
            if clear_current and self.current_release_id == release_id:
                self.current_release_id = None
            if release:
                release_path = release.path
            self.save_state()
        if remove_dir:
            self._delete_release_directory(release_path)

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
                **build_hidden_process_kwargs(),
                check=False,
            )
        if result.returncode != 0:
            raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command)}")

    def _node_executable(self) -> str:
        node_path = shutil.which("node")
        if node_path:
            return node_path
        raise RuntimeError("Node.js executable was not found on PATH.")

    def _build_frontend_bundle(self, *, release_id: str, env: dict[str, str]) -> None:
        web_dir = self.config.repo_root / "apps" / "web"
        node_executable = self._node_executable()
        tsc_entry = web_dir / "node_modules" / "typescript" / "bin" / "tsc"
        vite_entry = web_dir / "node_modules" / "vite" / "bin" / "vite.js"
        if not tsc_entry.exists():
            raise RuntimeError(f"Missing frontend build tool: {tsc_entry}")
        if not vite_entry.exists():
            raise RuntimeError(f"Missing frontend build tool: {vite_entry}")

        self._run_logged_command(
            command=[node_executable, str(tsc_entry), "-b"],
            cwd=web_dir,
            env=env,
            log_name=f"{release_id}-web-build.log",
        )
        self._run_logged_command(
            command=[node_executable, str(vite_entry), "build"],
            cwd=web_dir,
            env=env,
            log_name=f"{release_id}-web-build.log",
        )

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

    def _release_runtime_pids(
        self,
        release_id: str,
        *,
        release_path: str | None = None,
        process_id: int | None = None,
    ) -> set[int]:
        pids: set[int] = set()
        if isinstance(process_id, int) and process_id > 0:
            pids.add(process_id)
        normalized_release_path = str(Path(release_path)) if release_path else None
        for item in list_active_runtime_instances():
            snapshot = item.get("runtime_snapshot")
            snapshot_path = str(Path(str(snapshot))) if snapshot else None
            snapshot_release_id = Path(snapshot_path).name if snapshot_path else None
            if snapshot_release_id != release_id and snapshot_path != normalized_release_path:
                continue
            pid = item.get("pid")
            if isinstance(pid, int) and pid > 0:
                pids.add(pid)
        return pids

    def _stop_release_process(self, release_id: str) -> None:
        release = self.releases.get(release_id)
        process = self.release_processes.pop(release_id, None)
        pids_to_kill = self._release_runtime_pids(
            release_id,
            release_path=release.path if release else None,
            process_id=process.pid if process is not None else release.process_id if release else None,
        )
        for pid in pids_to_kill:
            try:
                kill_process_tree(pid)
            except Exception:
                pass
        if process is not None:
            try:
                process.wait(timeout=5)
            except Exception:
                pass
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
        api_dir = release_dir / "apps" / "api"
        env["MEMORY_ANKI_HOME"] = str(self.config.app_home)
        env["PYTHONPATH"] = str(api_dir / "src")
        env["MEMORY_ANKI_STARTUP_MODE"] = "prepare"
        self._run_logged_command(
            command=[sys.executable, "-m", "memory_anki.app.runtime_prepare"],
            cwd=api_dir,
            env=env,
            log_name=f"{release_id}-prepare.log",
        )

    def _start_release_backend(self, release: ReleaseRecord) -> None:
        port = self._find_free_port()
        api_dir = Path(release.path) / "apps" / "api"
        api_src_dir = api_dir / "src"
        api_log = self.config.logs_dir / f"{release.release_id}-api.log"
        with api_log.open("ab") as log_file:
            env = os.environ.copy()
            env["MEMORY_ANKI_HOME"] = str(self.config.app_home)
            env["MEMORY_ANKI_CHANNEL"] = "production"
            env["MEMORY_ANKI_WEB_DIST"] = str(Path(release.path) / "apps" / "web" / "dist")
            env["MEMORY_ANKI_RUNTIME_SNAPSHOT"] = str(release.path)
            env["MEMORY_ANKI_STARTUP_MODE"] = "serve"
            env["PYTHONPATH"] = str(api_src_dir)
            commit = detect_git_commit(self.config.repo_root)
            if commit:
                env["MEMORY_ANKI_GIT_COMMIT"] = commit
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "--app-dir",
                    str(api_src_dir),
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
                **build_hidden_process_kwargs(),
                close_fds=False,
            )
        release.port = port
        release.process_id = process.pid
        self.release_processes[release.release_id] = process

    def _begin_pending_release(
        self,
        release: ReleaseRecord,
        *,
        promote_immediately: bool,
    ) -> str | None:
        previous_candidate_id: str | None = None
        with self.lock:
            if self.candidate_release_id and self.candidate_release_id != release.release_id:
                previous_candidate_id = self.candidate_release_id
            self.releases[release.release_id] = release
            self.release_sessions.setdefault(release.release_id, {})
            if promote_immediately or self.current_release_id is None:
                self.candidate_release_id = None
            else:
                self.candidate_release_id = release.release_id
            self.save_state()
        return previous_candidate_id

    def _finalize_successful_release(
        self,
        release: ReleaseRecord,
        *,
        fingerprint: str,
        promote_immediately: bool,
    ) -> None:
        with self.lock:
            previous_release_id = self.current_release_id
            self.last_publish_error = None
            self.last_failed_fingerprint = None
            self.last_repo_fingerprint = fingerprint
            self.last_successful_release_id = release.release_id
            if promote_immediately or self.current_release_id is None:
                self.current_release_id = release.release_id
                self.candidate_release_id = None
                if previous_release_id and previous_release_id in self.releases:
                    self.releases[previous_release_id].retired_at = time.time()
            self.save_state()

    def _protected_release_ids(self) -> set[str]:
        with self.lock:
            return set(self.releases.keys()) | set(self.pending_release_ids)

    def _reconcile_orphan_releases(self) -> None:
        protected_release_ids = self._protected_release_ids()
        orphan_release_ids: set[str] = set()
        orphan_pids: set[int] = set()
        for item in list_active_runtime_instances():
            snapshot = item.get("runtime_snapshot")
            if not snapshot:
                continue
            snapshot_path = Path(str(snapshot))
            try:
                snapshot_path.relative_to(self.config.releases_root)
            except ValueError:
                continue
            release_id = snapshot_path.name
            if release_id in protected_release_ids:
                continue
            orphan_release_ids.add(release_id)
            pid = item.get("pid")
            if isinstance(pid, int) and pid > 0:
                orphan_pids.add(pid)
        for pid in orphan_pids:
            kill_process_tree(pid)
        if self.config.releases_root.exists():
            for path in self.config.releases_root.iterdir():
                if not path.is_dir():
                    continue
                if path.name in protected_release_ids:
                    continue
                orphan_release_ids.add(path.name)
                shutil.rmtree(path, ignore_errors=True)

    def _wait_for_backend_health(self, release: ReleaseRecord, timeout_seconds: int = 90) -> None:
        deadline = time.time() + timeout_seconds
        url = f"http://{self.config.host}:{release.port}/api/v1/runtime-health"
        while time.time() < deadline:
            payload = http_get_json(url)
            if payload and payload.get("ok"):
                release.ready = True
                return
            process = self.release_processes.get(release.release_id)
            if process and process.poll() is not None:
                raise RuntimeError(f"Backend exited before healthcheck for release {release.release_id}.")
            time.sleep(0.5)
        raise TimeoutError(f"Timed out waiting for backend health: {release.release_id}")

    def _publish_release(self, *, promote_immediately: bool) -> ReleaseRecord:
        release_id = make_release_id()
        fingerprint = self._compute_source_fingerprint()
        runtime_generation = self._load_runtime_generation(self.config.repo_root)
        release_dir = self.config.releases_root / release_id
        if not self._release_is_compatible(runtime_generation):
            self.last_publish_error = (
                "Detected runtime generation change. Automatic hot publish is blocked until a manual maintenance release."
            )
            self.last_blocked_fingerprint = fingerprint
            raise RuntimeError(self.last_publish_error)

        self.last_publish_error = None
        with self.lock:
            self.pending_release_ids.add(release_id)
        try:
            web_env = os.environ.copy()
            web_env["MEMORY_ANKI_HOME"] = str(self.config.app_home)
            self._build_frontend_bundle(release_id=release_id, env=web_env)
            self._snapshot_release(release_dir)
            self._prepare_release(release_dir, release_id)
        except Exception:
            with self.lock:
                self.pending_release_ids.discard(release_id)
            self._delete_release_directory(str(release_dir))
            raise
        try:
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
                        "created_at": iso_now(),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            previous_candidate_id = self._begin_pending_release(
                release,
                promote_immediately=promote_immediately,
            )
        except Exception:
            with self.lock:
                self.pending_release_ids.discard(release_id)
            self._delete_release_directory(str(release_dir))
            raise
        with self.lock:
            self.pending_release_ids.discard(release_id)
        if previous_candidate_id and previous_candidate_id != release.release_id:
            self._discard_release(previous_candidate_id, clear_candidate=True, remove_dir=True)
        try:
            self._start_release_backend(release)
            self._wait_for_backend_health(release)
        except Exception:
            self._discard_release(
                release.release_id,
                clear_candidate=True,
                remove_dir=True,
            )
            raise
        self._finalize_successful_release(
            release,
            fingerprint=fingerprint,
            promote_immediately=promote_immediately,
        )
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
        self._discard_release(candidate_id, clear_candidate=True, remove_dir=True)
        with self.lock:
            current = self.releases.get(self.current_release_id or "")
            self.last_repo_fingerprint = current.fingerprint if current else ""
            self.save_state()

    def _candidate_is_routable_locked(self) -> bool:
        if not self.candidate_release_id:
            return False
        candidate = self.releases.get(self.candidate_release_id)
        return bool(candidate and candidate.ready and candidate.port)

    def _publish_worker(self, *, promote_immediately: bool) -> None:
        supervisor_lifecycle.publish_worker(self, promote_immediately=promote_immediately)

    def trigger_publish(self, *, promote_immediately: bool = False) -> None:
        supervisor_lifecycle.trigger_publish(self, promote_immediately=promote_immediately)

    def _watch_builds_disabled(self) -> bool:
        return supervisor_lifecycle.watch_builds_disabled()

    def _watch_loop(self) -> None:
        supervisor_lifecycle.watch_loop(self)

    def _cleanup_releases(self) -> None:
        supervisor_lifecycle.cleanup_releases(self)

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

    def _select_release_for_request(self, handler: Any) -> tuple[ReleaseRecord, str | None]:
        return supervisor_proxy.select_release_for_request(self, handler)

    def _supervisor_status(self) -> dict[str, Any]:
        return supervisor_proxy.supervisor_status(self)

    def _proxy_request(self, handler: Any) -> None:
        supervisor_proxy.proxy_request(self, handler)

    def make_handler(self):
        return supervisor_proxy.make_handler(self)

    def start(self) -> None:
        supervisor_lifecycle.start(self)

    def shutdown(self) -> None:
        supervisor_lifecycle.shutdown(self)


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
        if resolve_runtime_run_mode() == RUN_MODE_SUPERVISOR:
            ensure_background_supervisor(open_browser_after_launch=True)
        else:
            ensure_latest_workspace_runtime(open_browser_after_launch=True)
        return 0
    if args.serve:
        return serve_supervisor()
    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
