"""Start the Memory Anki web stack and open the desktop app with a timer overlay."""

from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import dev_server  # noqa: E402
import pwa_server  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = REPO_ROOT / "apps" / "web"
FRONTEND_URL = f"http://{dev_server.BACKEND_HOST}:{dev_server.BACKEND_PORT}/"
DESKTOP_READY_TIMEOUT_SECONDS = 60


def ensure_shared_tray() -> None:
    if os.name != "nt":
        return
    tray_script = REPO_ROOT / "tools" / "pwa_tray.ps1"
    subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-STA",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
            str(tray_script),
            "-AttachOnly",
        ],
        cwd=str(REPO_ROOT),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **dev_server.hidden_process_kwargs(),
    )


def main() -> int:
    started_at = time.perf_counter()
    log_path = dev_server.LOGS_DIR / "desktop-startup.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    def log(message: str) -> None:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(f"[{timestamp}] {message}\n")

    log("Desktop startup requested")
    dev_server.free_port(dev_server.FRONTEND_PORT, "frontend")

    # The desktop launch requests detailed backend diagnostics while keeping
    # the long-running service detached from the launcher's output pipe.
    os.environ["MEMORY_ANKI_VISIBLE_BACKEND"] = "1"
    if pwa_server.restart_for_desktop() != 0:
        log("Shared service restart failed")
        return 1
    log(f"Shared service ready after {time.perf_counter() - started_at:.2f}s")
    ensure_shared_tray()

    npm = dev_server._resolve_npm()
    if not pwa_server._ensure_desktop_runtime():
        log("Electron runtime repair failed")
        return 1
    ready_path = dev_server.LOGS_DIR / f"desktop-ready-{uuid.uuid4().hex}.json"
    env = os.environ.copy()
    env["MEMORY_ANKI_DESKTOP_URL"] = FRONTEND_URL
    env["MEMORY_ANKI_TIMER_OVERLAY_URL"] = f"{FRONTEND_URL.rstrip('/')}/timer-overlay"
    env["MEMORY_ANKI_DESKTOP_READY_FILE"] = str(ready_path)
    print("[i] Launching Memory Anki desktop + timer overlay ...")
    log_file = log_path.open("a", encoding="utf-8")
    try:
        process = subprocess.Popen(
            [npm, "run", "desktop:timer"],
            cwd=str(WEB_DIR),
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            **dev_server.hidden_process_kwargs(),
        )
    finally:
        log_file.close()
    deadline = time.monotonic() + DESKTOP_READY_TIMEOUT_SECONDS
    try:
        while time.monotonic() < deadline:
            if ready_path.is_file():
                log(f"Desktop window ready after {time.perf_counter() - started_at:.2f}s")
                return 0
            return_code = process.poll()
            if return_code is not None:
                log(f"Desktop exited before ready with code {return_code}")
                return int(return_code or 1)
            time.sleep(0.2)
        log("Desktop readiness timed out")
        dev_server.kill_process_tree(process.pid)
        return 1
    finally:
        ready_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
