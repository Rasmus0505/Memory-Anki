"""Start Memory Anki as a production PWA server for Tailscale access."""

from __future__ import annotations

import os
import hashlib
import json
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import dev_server  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
API_DIR = REPO_ROOT / "apps" / "api"
WEB_DIR = REPO_ROOT / "apps" / "web"
WEB_DIST = WEB_DIR / "dist"
LOGS_DIR = REPO_ROOT / "logs"
PWA_URL = f"http://{dev_server.BACKEND_HOST}:{dev_server.BACKEND_PORT}/freestyle"
PWA_PROCESS_MARKER = "MEMORY_ANKI_PWA_SERVER"
PWA_PID_FILE = LOGS_DIR / "pwa-server.pid"
PWA_LOCK_FILE = LOGS_DIR / "pwa-service.lock"
UPDATE_STATE_VERSION = 1


def _update_state_path() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    root = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return root / "MemoryAnki" / "update-state.json"


def _iter_files(paths: list[Path]):
    for path in paths:
        if not path.exists():
            continue
        if path.is_file():
            yield path
            continue
        for item in sorted(path.rglob("*")):
            if not item.is_file():
                continue
            if any(part in {"node_modules", "dist", "__pycache__", ".pytest_cache"} for part in item.parts):
                continue
            yield item


def _fingerprint(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in _iter_files(paths):
        try:
            relative = path.relative_to(REPO_ROOT).as_posix()
        except ValueError:
            relative = str(path)
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def _current_update_fingerprints() -> dict[str, str]:
    frontend = _fingerprint(
        [
            WEB_DIR / "src",
            WEB_DIR / "public",
            WEB_DIR / "index.html",
            WEB_DIR / "vite.config.ts",
            WEB_DIR / "package.json",
            WEB_DIR / "package-lock.json",
            WEB_DIR / "tsconfig.json",
            WEB_DIR / "tsconfig.app.json",
            WEB_DIR / "tsconfig.node.json",
        ]
    )
    migrations = _fingerprint([API_DIR / "alembic", API_DIR / "alembic.ini"])
    backend = _fingerprint(
        [
            API_DIR / "src",
            API_DIR / "requirements.txt",
            API_DIR / "pyproject.toml",
            REPO_ROOT / "apps" / "desktop-timer" / "main.cjs",
            REPO_ROOT / "apps" / "desktop-timer" / "preload.cjs",
            REPO_ROOT / "tools" / "desktop_launcher.ps1",
            REPO_ROOT / "tools" / "desktop_timer.py",
            REPO_ROOT / "tools" / "dev_server.py",
            REPO_ROOT / "tools" / "pwa_launcher.ps1",
            REPO_ROOT / "tools" / "pwa_server.py",
            REPO_ROOT / "tools" / "pwa_tray.ps1",
            REPO_ROOT / "tools" / "windows_runtime.ps1",
            REPO_ROOT / "start-desktop.bat",
            REPO_ROOT / "start-pwa.bat",
            REPO_ROOT / ".env.example",
        ]
    )
    return {"frontend": frontend, "backend": backend, "migrations": migrations}


def _read_update_state() -> dict[str, str]:
    try:
        data = json.loads(_update_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    if data.get("version") != UPDATE_STATE_VERSION:
        return {}
    return {name: str(data.get(name) or "") for name in ("frontend", "backend", "migrations")}


def _write_update_state(fingerprints: dict[str, str]) -> None:
    path = _update_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    payload = {"version": UPDATE_STATE_VERSION, **fingerprints}
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _database_at_alembic_head() -> bool:
    try:
        from alembic.script import ScriptDirectory
        from memory_anki.infrastructure.db.migrations import build_alembic_config

        expected_heads = set(ScriptDirectory.from_config(build_alembic_config()).get_heads())
        database_path = dev_server._resolve_configured_app_home() / "data" / "memory_palace.db"
        if not database_path.exists():
            return False
        with sqlite3.connect(database_path) as connection:
            rows = connection.execute("SELECT version_num FROM alembic_version").fetchall()
        return {str(row[0]) for row in rows} == expected_heads
    except Exception:
        return False


def _append_log_separator(path: Path, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with path.open("ab") as log_file:
        log_file.write(f"\n\n===== {title} {timestamp} =====\n".encode("utf-8"))


def _process_command_line(pid: int) -> str:
    if os.name != "nt":
        return ""
    try:
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-Command",
                (
                    "$process = Get-CimInstance Win32_Process -Filter "
                    f"\"ProcessId={pid}\" -ErrorAction SilentlyContinue; "
                    "if ($process) { $process.CommandLine }"
                ),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except Exception:
        return ""
    return result.stdout.strip().lower()


def _is_memory_anki_service_process(pid: int) -> bool:
    try:
        recorded_pid = int(PWA_PID_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        recorded_pid = 0
    if os.name != "nt":
        return recorded_pid == pid
    command_line = _process_command_line(pid)
    repo_marker = str(REPO_ROOT).lower()
    return PWA_PROCESS_MARKER.lower() in command_line or (
        "memory_anki.app.main:app" in command_line and repo_marker in command_line
    )


@contextmanager
def service_lock(timeout_seconds: float = 180.0):
    """Serialize PWA start/stop/sync so desktop and tray startup cannot race."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    lock_file = PWA_LOCK_FILE.open("a+b")
    lock_file.seek(0, os.SEEK_END)
    if lock_file.tell() == 0:
        lock_file.write(b"\0")
        lock_file.flush()

    deadline = time.monotonic() + timeout_seconds
    acquired = False
    try:
        while not acquired:
            try:
                lock_file.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Timed out waiting for the Memory Anki service lock")
                time.sleep(0.1)
        yield
    finally:
        if acquired:
            lock_file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()


def _stop_service_unlocked() -> bool:
    pids = dev_server.list_listening_pids(dev_server.BACKEND_PORT)
    if not pids:
        PWA_PID_FILE.unlink(missing_ok=True)
        return True
    unsafe = [pid for pid in pids if not _is_memory_anki_service_process(pid)]
    if unsafe:
        print(
            f"[!] The shared service address is occupied by non-Memory-Anki "
            f"process(es): {unsafe}. Stop that program before starting Memory Anki."
        )
        return False
    print(f"[i] Stopping existing Memory Anki service: {pids}")
    for pid in pids:
        dev_server.kill_process_tree(pid)
    PWA_PID_FILE.unlink(missing_ok=True)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if not dev_server.list_listening_pids(dev_server.BACKEND_PORT):
            return True
        time.sleep(0.2)
    print("[!] The shared service did not stop within 10 seconds.")
    return False


def _pwa_dist_ready() -> bool:
    required = [
        WEB_DIST / "index.html",
        WEB_DIST / "manifest.webmanifest",
        WEB_DIST / "release.json",
        WEB_DIST / "sw.js",
        WEB_DIST / "offline.html",
    ]
    return all(path.exists() for path in required)


def _validate_web_release() -> bool:
    try:
        release = json.loads((WEB_DIST / "release.json").read_text(encoding="utf-8"))
        release_id = str(release.get("releaseId") or "")
        index_html = (WEB_DIST / "index.html").read_text(encoding="utf-8")
        service_worker = (WEB_DIST / "sw.js").read_text(encoding="utf-8")
    except (OSError, ValueError, TypeError) as exc:
        print(f"[!] PWA release metadata is invalid: {exc}")
        return False
    if not release_id:
        print("[!] PWA releaseId is missing.")
        return False
    if f'content="{release_id}"' not in index_html or f"const RELEASE_ID = '{release_id}'" not in service_worker:
        print("[!] PWA releaseId does not match index.html and sw.js.")
        return False
    if "__MEMORY_ANKI_RELEASE_ID__" in service_worker:
        print("[!] PWA service worker still contains an unresolved release placeholder.")
        return False
    asset_paths = re.findall(r'(?:src|href)="(/assets/[^"]+)"', index_html)
    missing = [asset for asset in asset_paths if not (WEB_DIST / asset.lstrip("/")).is_file()]
    if missing:
        print(f"[!] PWA index references missing assets: {missing}")
        return False
    return True


def _desktop_runtime_ready() -> bool:
    if os.name != "nt":
        return True
    return (WEB_DIR / "node_modules" / "electron" / "dist" / "electron.exe").is_file()


def _ensure_desktop_runtime() -> bool:
    if _desktop_runtime_ready():
        return True
    try:
        npm = dev_server._resolve_npm()
    except Exception as exc:
        print(f"[!] Unable to find npm for Electron repair: {exc}")
        return False
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / "electron-install.log"
    _append_log_separator(log_path, "Electron runtime repair")
    print(f"[i] Electron runtime is incomplete; repairing it, log: {log_path}")
    with log_path.open("ab") as log_file:
        result = subprocess.run(
            [npm, "rebuild", "electron", "--foreground-scripts"],
            cwd=str(WEB_DIR),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            check=False,
            **dev_server.hidden_process_kwargs(),
        )
    if result.returncode != 0 or not _desktop_runtime_ready():
        print(f"[!] Electron runtime repair failed. See {log_path}")
        return False
    print("[ok] Electron desktop runtime is ready")
    return True


def _run_frontend_build() -> bool:
    try:
        npm = dev_server._resolve_npm()
    except Exception as exc:
        print(f"[!] Unable to find npm: {exc}")
        return False
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / "pwa-build.log"
    _append_log_separator(log_path, "PWA frontend build")
    print(f"[i] Building PWA frontend, log: {log_path}")
    with log_path.open("ab") as log_file:
        result = subprocess.run(
            [npm, "run", "build"],
            cwd=str(WEB_DIR),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=_backend_env(),
            check=False,
            **dev_server.hidden_process_kwargs(),
        )
    if result.returncode != 0:
        print(f"[!] PWA frontend build failed ({result.returncode}). See {log_path}")
        return False
    if not _validate_web_release():
        print(f"[!] PWA frontend release validation failed. See {log_path}")
        return False
    return True


def _prepare_runtime() -> bool:
    try:
        local_env = _backend_env()
        dev_server.ensure_backend_runtime_prepared(env=local_env)
        dev_server.ensure_backend_migrations_applied(env=local_env)
    except Exception as exc:
        print(f"[!] Runtime database preparation failed: {exc}")
        return False
    return True


def _ensure_runtime_initialized() -> bool:
    try:
        dev_server.ensure_backend_runtime_prepared(env=_backend_env())
    except Exception as exc:
        print(f"[!] Runtime database preparation failed: {exc}")
        return False
    return True


def _backend_env() -> dict[str, str]:
    env = dev_server._backend_env()
    env["MEMORY_ANKI_WEB_DIST"] = str(WEB_DIST)
    env["MEMORY_ANKI_CHANNEL"] = "pwa"
    env["MEMORY_ANKI_STARTUP_MODE"] = "healthcheck"
    env[PWA_PROCESS_MARKER] = "1"
    env["PYTHONPATH"] = str(API_SRC)
    return env


def _backend_console_is_visible() -> bool:
    return os.environ.get("MEMORY_ANKI_VISIBLE_BACKEND", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _start_backend() -> subprocess.Popen:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / "pwa-api.log"
    _append_log_separator(log_path, "PWA backend")
    print("[i] Starting shared Memory Anki service")
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "--app-dir",
        str(API_SRC),
        "memory_anki.app.main:app",
        "--host",
        dev_server.BACKEND_HOST,
        "--port",
        str(dev_server.BACKEND_PORT),
    ]
    visible = _backend_console_is_visible()
    log_file = log_path.open("ab")
    if visible:
        print(f"[i] Backend output is written to {log_path}; startup errors remain in diagnostics.")
    try:
        process = subprocess.Popen(
            cmd,
            cwd=str(API_DIR),
            env=_backend_env(),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            close_fds=True,
            **dev_server.hidden_process_kwargs(),
        )
    finally:
        log_file.close()
    PWA_PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    PWA_PID_FILE.write_text(str(process.pid), encoding="utf-8")
    return process


def _wait_for_pwa(timeout_seconds: int = 120, process: subprocess.Popen | None = None) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if process is not None and process.poll() is not None:
            return False
        if not dev_server.wait_for_backend(timeout_seconds=2):
            time.sleep(0.5)
            continue
        try:
            with urlopen(PWA_URL, timeout=2) as response:
                if response.status == 200:
                    return True
        except (OSError, TimeoutError, URLError):
            pass
        time.sleep(0.5)
    return False


def _pwa_is_ready() -> bool:
    payload = dev_server.http_get_json(dev_server.HEALTH_URL, timeout=1.5)
    if not payload or not payload.get("ok"):
        return False
    try:
        with urlopen(PWA_URL, timeout=1.5) as response:
            return response.status == 200
    except (OSError, TimeoutError, URLError):
        return False


def _configure_tailscale_serve() -> bool:
    tailscale = _resolve_tailscale_cli()
    if not tailscale:
        print("[!] Tailscale CLI was not found. Install Tailscale first.")
        return False
    print(f"[i] Configuring Tailscale Serve: HTTPS -> 127.0.0.1:{dev_server.BACKEND_PORT}")
    result = subprocess.run(
        [tailscale, "serve", "--bg", str(dev_server.BACKEND_PORT)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
    if output:
        print(output)
    if result.returncode == 0:
        print("[ok] Tailscale Serve configured.")
        status = subprocess.run(
            [tailscale, "serve", "status"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        status_output = "\n".join(part for part in [status.stdout.strip(), status.stderr.strip()] if part)
        if status_output:
            print("[i] Current Tailscale Serve status:")
            print(status_output)
        return True
    print("[!] Tailscale Serve could not be configured from this shell.")
    print("[i] Run configure-tailscale-pwa.bat once as Administrator.")
    return False


def _resolve_tailscale_cli() -> str | None:
    tailscale = shutil.which("tailscale")
    if tailscale:
        return tailscale
    if os.name != "nt":
        return None
    candidates = [
        Path(os.environ.get("ProgramFiles", "")) / "Tailscale" / "tailscale.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Tailscale" / "tailscale.exe",
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Tailscale" / "tailscale.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def _supervise(process: subprocess.Popen) -> int:
    print("[i] PWA server is running. Keep this process alive, or use stop-pwa.bat to stop it.")
    stopping = False

    def stop_child(*args) -> None:
        nonlocal stopping
        stopping = True
        if process.poll() is None:
            dev_server.kill_process_tree(process.pid)

    signal.signal(signal.SIGTERM, stop_child)
    signal.signal(signal.SIGINT, stop_child)
    while process.poll() is None and not stopping:
        time.sleep(5)
    return int(process.returncode or 0)


def start(
    *,
    build: bool = False,
    configure_serve: bool = False,
    sync: bool = False,
    supervise: bool = True,
) -> int:
    started_at = time.perf_counter()

    def stage(message: str) -> None:
        print(f"[i] {message} ({time.perf_counter() - started_at:.2f}s)", flush=True)

    process: subprocess.Popen | None = None
    with service_lock():
        stage("Checking shared service")
        pids = dev_server.list_listening_pids(dev_server.BACKEND_PORT)
        unsafe = [pid for pid in pids if not _is_memory_anki_service_process(pid)]
        if unsafe:
            print(
                f"[!] The shared service address is occupied by non-Memory-Anki "
                f"process(es): {unsafe}. Stop that program before starting Memory Anki."
            )
            return 1

        can_reuse_service = (
            bool(pids)
            and _pwa_is_ready()
            and not build
            and not sync
            and _database_at_alembic_head()
        )
        if can_reuse_service:
            print("[ok] Reusing running Memory Anki service")
        else:
            if pids and not _stop_service_unlocked():
                return 1
            if build or not _pwa_dist_ready():
                stage("Building frontend assets")
                if not _run_frontend_build():
                    return 1

            if sync and not dev_server.sync_before_start():
                return 1
            if not sync:
                stage("Skipping startup sync (desktop start/stop handles synchronization)")

            # Always migrate after the shared service is stopped. Synced databases can arrive
            # behind the current ORM even when frontend/backend fingerprints are unchanged.
            stage("Preparing local runtime and database migrations")
            if not _prepare_runtime():
                return 1

            stage("Starting backend")
            process = _start_backend()
            if not _wait_for_pwa(timeout_seconds=120, process=process):
                print("[!] PWA server did not become ready. See logs\\pwa-api.log")
                dev_server.kill_process_tree(process.pid)
                return 1

            print("[ok] Shared Memory Anki service is ready")

    print(f"[ok] Startup completed in {time.perf_counter() - started_at:.2f}s", flush=True)
    if configure_serve:
        _configure_tailscale_serve()
    if supervise and process is not None:
        return _supervise(process)
    return 0


def stop() -> int:
    with service_lock():
        return 0 if _stop_service_unlocked() else 1


def restart_for_desktop() -> int:
    """Restart the shared service around desktop startup sync, then leave it running."""
    with service_lock():
        if not _stop_service_unlocked():
            return 1
        if not dev_server.sync_before_start():
            return 1
        if not _pwa_dist_ready() and not _run_frontend_build():
            return 1
        if not _prepare_runtime():
            return 1
        process = _start_backend()
        if not _wait_for_pwa(timeout_seconds=120, process=process):
            print("[!] Shared service did not become ready. See logs\\pwa-api.log")
            dev_server.kill_process_tree(process.pid)
            return 1
        print("[ok] Shared Memory Anki service is ready")
        return 0


def stop_for_desktop_sync() -> int:
    """Stop the shared service and push local data without another start racing in."""
    with service_lock():
        if not _stop_service_unlocked():
            return 1
        return 0 if dev_server.sync_after_stop() else 1


def prepare(*, build: bool = True) -> int:
    with service_lock():
        started_at = time.perf_counter()
        current = _current_update_fingerprints()
        previous = _read_update_state()
        frontend_changed = build and (
            not previous or current["frontend"] != previous.get("frontend") or not _pwa_dist_ready()
        )
        desktop_runtime_missing = not _desktop_runtime_ready()
        backend_changed = not previous or current["backend"] != previous.get("backend")
        migrations_changed = (
            not previous
            or current["migrations"] != previous.get("migrations")
            or not _database_at_alembic_head()
        )

        if not frontend_changed and not desktop_runtime_missing and not backend_changed and not migrations_changed:
            print(f"[ok] Memory Anki is already up to date ({time.perf_counter() - started_at:.2f}s).")
            return 0

        changed = []
        if frontend_changed:
            changed.append("frontend")
        if desktop_runtime_missing:
            changed.append("desktop runtime")
        if backend_changed:
            changed.append("backend")
        if migrations_changed:
            changed.append("database")
        print(f"[i] Updating: {', '.join(changed)}")

        dev_server.kill_memory_anki_desktop_processes()
        dev_server.free_port(dev_server.FRONTEND_PORT, "frontend")
        if not _stop_service_unlocked():
            return 1
        if not dev_server.sync_after_stop():
            return 1

        if desktop_runtime_missing and not _ensure_desktop_runtime():
            return 1
        if frontend_changed:
            if not _run_frontend_build():
                return 1
        if not _ensure_runtime_initialized():
            return 1
        if migrations_changed:
            try:
                dev_server.ensure_backend_migrations_applied(env=_backend_env())
            except Exception as exc:
                print(f"[!] Runtime database preparation failed: {exc}")
                return 1
        _write_update_state(current)
        print(f"[ok] PWA assets and runtime are ready: {WEB_DIST}")
        print(f"[ok] Update completed in {time.perf_counter() - started_at:.2f}s")
        return 0


def main() -> int:
    args = set(sys.argv[1:])
    if "--stop" in args:
        return stop()
    if "--prepare" in args:
        return prepare(build="--no-build" not in args)
    return start(
        build="--build" in args,
        configure_serve="--configure-serve" in args,
        sync="--sync" in args,
        supervise="--no-supervise" not in args,
    )


if __name__ == "__main__":
    raise SystemExit(main())
