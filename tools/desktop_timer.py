"""Start the Memory Anki web stack and open the desktop app with a timer overlay."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import dev_server  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = REPO_ROOT / "apps" / "web"
FRONTEND_URL = f"http://{dev_server.BACKEND_HOST}:{dev_server.FRONTEND_PORT}/"


def main() -> int:
    dev_server.free_port(dev_server.BACKEND_PORT, "backend")
    dev_server.free_port(dev_server.FRONTEND_PORT, "frontend")

    if not dev_server.sync_before_start():
        return 1

    try:
        dev_server.ensure_backend_runtime_prepared()
        dev_server.ensure_backend_migrations_applied()
    except Exception as exc:
        print(f"[!] Runtime database preparation failed: {exc}")
        return 1

    backend_proc = dev_server.start_backend()
    print("[i] Waiting for backend ...", end=" ", flush=True)
    if not dev_server.wait_for_backend(timeout_seconds=120):
        print("timeout")
        dev_server.kill_process_tree(backend_proc.pid)
        return 1
    print("OK")

    frontend_proc = dev_server.start_frontend()
    print("[i] Waiting for frontend ...", end=" ", flush=True)
    if not dev_server.wait_for_frontend(timeout_seconds=40):
        print("timeout")
        dev_server.kill_process_tree(backend_proc.pid)
        dev_server.kill_process_tree(frontend_proc.pid)
        return 1
    print("OK")

    npm = dev_server._resolve_npm()
    env = os.environ.copy()
    env["MEMORY_ANKI_DESKTOP_URL"] = FRONTEND_URL
    env["MEMORY_ANKI_TIMER_OVERLAY_URL"] = f"{FRONTEND_URL.rstrip('/')}/timer-overlay"
    print("[i] Launching Memory Anki desktop + timer overlay ...")
    result = subprocess.run(
        [npm, "run", "desktop:timer"],
        cwd=str(WEB_DIR),
        env=env,
        check=False,
    )
    return int(result.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
