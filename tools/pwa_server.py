"""Start Memory Anki as a production PWA server for Tailscale access."""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
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


def _append_log_separator(path: Path, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with path.open("ab") as log_file:
        log_file.write(f"\n\n===== {title} {timestamp} =====\n".encode("utf-8"))


def _is_memory_anki_pwa_process(pid: int) -> bool:
    if os.name != "nt":
        return True
    try:
        result = subprocess.run(
            [
                "wmic",
                "process",
                "where",
                f"ProcessId={pid}",
                "get",
                "CommandLine",
                "/value",
            ],
            capture_output=True,
            text=True,
            encoding="gbk",
            errors="replace",
            check=False,
        )
    except Exception:
        return False
    command_line = result.stdout.lower()
    repo_marker = str(REPO_ROOT).lower()
    return (
        PWA_PROCESS_MARKER.lower() in command_line
        or (
            repo_marker in command_line
            and "memory_anki.app.main:app" in command_line
            and "uvicorn" in command_line
        )
    )


def _free_pwa_port() -> bool:
    pids = dev_server.list_listening_pids(dev_server.BACKEND_PORT)
    if not pids:
        return True
    unsafe = [pid for pid in pids if not _is_memory_anki_pwa_process(pid)]
    if unsafe:
        print(
            f"[!] Port {dev_server.BACKEND_PORT} is occupied by non-PWA process(es): {unsafe}. "
            "Stop them manually or run desktop stop.bat first."
        )
        return False
    print(f"[i] Cleaning existing PWA process(es) on port {dev_server.BACKEND_PORT}: {pids}")
    for pid in pids:
        dev_server.kill_process_tree(pid)
    time.sleep(0.5)
    return True


def _pwa_dist_ready() -> bool:
    required = [
        WEB_DIST / "index.html",
        WEB_DIST / "manifest.webmanifest",
        WEB_DIST / "sw.js",
        WEB_DIST / "offline.html",
    ]
    return all(path.exists() for path in required)


def _run_frontend_build() -> bool:
    npm = dev_server._resolve_npm()
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
    return True


def _backend_env() -> dict[str, str]:
    env = dev_server._backend_env()
    env["MEMORY_ANKI_WEB_DIST"] = str(WEB_DIST)
    env["MEMORY_ANKI_CHANNEL"] = "pwa"
    env["MEMORY_ANKI_STARTUP_MODE"] = "healthcheck"
    env[PWA_PROCESS_MARKER] = "1"
    env["PYTHONPATH"] = str(API_SRC)
    return env


def _start_backend() -> subprocess.Popen:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / "pwa-api.log"
    _append_log_separator(log_path, "PWA backend")
    print(f"[i] Starting PWA backend at {PWA_URL}")
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
    log_file = log_path.open("ab")
    return subprocess.Popen(
        cmd,
        cwd=str(API_DIR),
        env=_backend_env(),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        close_fds=False,
        **dev_server.hidden_process_kwargs(),
    )


def _wait_for_pwa(timeout_seconds: int = 120) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
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
    if not _free_pwa_port():
        return 1

    if build or not _pwa_dist_ready():
        if not _run_frontend_build():
            return 1

    if sync and not dev_server.sync_before_start():
        return 1
    if not sync:
        print("[i] Skipping startup sync for PWA autostart. Desktop stop/start still performs sync.")

    try:
        local_env = _backend_env()
        dev_server.ensure_backend_runtime_prepared(env=local_env)
        dev_server.ensure_backend_migrations_applied(env=local_env)
    except Exception as exc:
        print(f"[!] Runtime database preparation failed: {exc}")
        return 1

    process = _start_backend()
    if not _wait_for_pwa(timeout_seconds=120):
        print("[!] PWA server did not become ready. See logs\\pwa-api.log")
        dev_server.kill_process_tree(process.pid)
        return 1

    print(f"[ok] PWA server ready: {PWA_URL}")
    if configure_serve:
        _configure_tailscale_serve()
    if supervise:
        return _supervise(process)
    return 0


def stop() -> int:
    return 0 if _free_pwa_port() else 1


def main() -> int:
    args = set(sys.argv[1:])
    if "--stop" in args:
        return stop()
    return start(
        build="--build" in args,
        configure_serve="--configure-serve" in args,
        sync="--sync" in args,
        supervise="--no-supervise" not in args,
    )


if __name__ == "__main__":
    raise SystemExit(main())
