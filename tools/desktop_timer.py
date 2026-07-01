"""Start the Memory Anki web stack and open the desktop app with a timer overlay."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import dev_server

REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = REPO_ROOT / "apps" / "web"
FRONTEND_URL = f"http://{dev_server.BACKEND_HOST}:{dev_server.FRONTEND_PORT}/"


def main() -> int:
    dev_server.free_port(dev_server.BACKEND_PORT, "后端")
    dev_server.free_port(dev_server.FRONTEND_PORT, "前端")

    if not dev_server.sync_before_start():
        return 1

    try:
        dev_server.ensure_backend_runtime_prepared()
    except Exception as exc:
        print(f"[!] 数据初始化失败: {exc}")
        return 1

    backend_proc = dev_server.start_backend()
    print("[i] 等待后端就绪 ...", end=" ", flush=True)
    if not dev_server.wait_for_backend(timeout_seconds=60):
        print("超时")
        dev_server.kill_process_tree(backend_proc.pid)
        return 1
    print("就绪 ✓")

    frontend_proc = dev_server.start_frontend()
    print("[i] 等待前端就绪 ...", end=" ", flush=True)
    if not dev_server.wait_for_frontend(timeout_seconds=40):
        print("超时")
        dev_server.kill_process_tree(backend_proc.pid)
        return 1
    print("就绪 ✓")

    npm = dev_server._resolve_npm()
    env = os.environ.copy()
    env["MEMORY_ANKI_DESKTOP_URL"] = FRONTEND_URL
    env["MEMORY_ANKI_TIMER_OVERLAY_URL"] = f"{FRONTEND_URL.rstrip('/')}/timer-overlay"
    print("[i] 启动 Memory Anki 桌面端 + 全局计时器小窗 ...")
    result = subprocess.run(
      [npm, "run", "desktop:timer"],
      cwd=str(WEB_DIR),
      env=env,
      check=False,
    )
    return int(result.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
