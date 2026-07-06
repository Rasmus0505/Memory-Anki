"""开发服务器启动编排器。

替代旧的 supervisor 系统，用最简单的方式启动 Memory Anki：
  1. 后端：uvicorn (FastAPI) 监听 8012，纯 API（不挂载前端静态）。
  2. 前端：vite dev 监听 5173，关闭 HMR，/api 经 vite proxy 转发到 8012。

设计原则（满足用户需求）：
  - 启动快速：vite dev 不做全量构建，几秒即就绪。
  - 启动完整：后端先健康检查通过，前端再启动并开浏览器。
  - 手动刷新更新：vite hmr=false + manualRefreshGuard（vite.config.ts 已配置），
    改 .tsx 后用户 F5 才看到更新，不会被自动刷新打断使用。
  - 改后端：重跑 start.bat 即重启 uvicorn 生效。

本脚本刻意自包含，不 import 任何 supervisor 模块，以便 supervisor 被删除后仍可用。
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
API_SRC = REPO_ROOT / "apps" / "api" / "src"
API_DIR = REPO_ROOT / "apps" / "api"
WEB_DIR = REPO_ROOT / "apps" / "web"
LOGS_DIR = REPO_ROOT / "logs"

sys.path.insert(0, str(API_SRC))

from memory_anki.core.file_sync import pull_on_start, push_on_stop  # noqa: E402
from memory_anki.core.local_config import load_local_runtime_config  # noqa: E402

BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8012
FRONTEND_PORT = 5173
HEALTH_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}/api/v1/runtime-health"
FRONTEND_URL = f"http://{BACKEND_HOST}:{FRONTEND_PORT}/"


# ---------------------------------------------------------------------------
# 进程/端口工具
# ---------------------------------------------------------------------------

def _creation_flags() -> int:
    flags = 0
    for name in ("DETACHED_PROCESS", "CREATE_NEW_PROCESS_GROUP", "CREATE_NO_WINDOW"):
        flags |= int(getattr(subprocess, name, 0))
    return flags


def hidden_process_kwargs() -> dict:
    """Windows 下隐藏子进程窗口，避免弹出黑框。"""
    kwargs: dict = {}
    flags = _creation_flags()
    if flags:
        kwargs["creationflags"] = flags
    if os.name == "nt":
        startupinfo_cls = getattr(subprocess, "STARTUPINFO", None)
        if startupinfo_cls is not None:
            si = startupinfo_cls()
            si.dwFlags |= int(getattr(subprocess, "STARTF_USESHOWWINDOW", 0))
            si.wShowWindow = int(getattr(subprocess, "SW_HIDE", 0))
            kwargs["startupinfo"] = si
    return kwargs


def list_listening_pids(port: int) -> list[int]:
    try:
        out = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True,
            text=True,
            encoding="gbk",
            errors="replace",
        ).stdout
    except Exception:
        return []
    pids: set[int] = set()
    for line in out.splitlines():
        if f":{port}" not in line or "LISTENING" not in line.upper():
            continue
        parts = [p for p in line.split() if p]
        if len(parts) < 5:
            continue
        try:
            pids.add(int(parts[-1]))
        except ValueError:
            continue
    return sorted(p for p in pids if p > 0)


def kill_process_tree(pid: int) -> None:
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def kill_memory_anki_desktop_processes() -> None:
    """Stop desktop launcher and Electron processes started from this repo."""
    try:
        out = subprocess.run(
            [
                "wmic",
                "process",
                "where",
                "name='python.exe' or name='node.exe' or name='electron.exe'",
                "get",
                "ProcessId,CommandLine",
                "/format:csv",
            ],
            capture_output=True,
            text=True,
            encoding="gbk",
            errors="replace",
            check=False,
        ).stdout
    except Exception:
        return

    repo_marker = str(REPO_ROOT).lower()
    matches: set[int] = set()
    for line in out.splitlines():
        if not line or "," not in line:
            continue
        lower = line.lower()
        if (
            "tools\\desktop_timer.py" not in lower
            and "desktop-timer\\main.cjs" not in lower
            and "run desktop:timer" not in lower
            and repo_marker not in lower
        ):
            continue
        parts = [part.strip() for part in line.rsplit(",", 1)]
        if len(parts) != 2:
            continue
        try:
            pid = int(parts[1])
        except ValueError:
            continue
        if pid > 0:
            matches.add(pid)

    for pid in sorted(matches):
        kill_process_tree(pid)


def free_port(port: int, label: str) -> None:
    pids = list_listening_pids(port)
    if not pids:
        return
    print(f"[i] 端口 {port} ({label}) 被占用，清理残留进程: {pids}")
    for pid in pids:
        kill_process_tree(pid)
    time.sleep(0.5)


# ---------------------------------------------------------------------------
# 健康检查
# ---------------------------------------------------------------------------

def http_get_json(url: str, timeout: float = 2.0):
    try:
        with urlopen(url, timeout=timeout) as resp:
            payload = resp.read().decode("utf-8")
    except (URLError, OSError, TimeoutError):
        return None
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def wait_for_backend(timeout_seconds: int = 60) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        payload = http_get_json(HEALTH_URL)
        if payload and payload.get("ok"):
            return True
        time.sleep(0.5)
    return False


def wait_for_frontend(timeout_seconds: int = 40) -> bool:
    """等 vite dev 监听端口就绪。"""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(1.0)
            try:
                if sock.connect_ex((BACKEND_HOST, FRONTEND_PORT)) == 0:
                    return True
            except OSError:
                pass
        time.sleep(0.4)
    return False


# ---------------------------------------------------------------------------
# 数据就绪检查（复用后端 runtime_prepare 逻辑）
# ---------------------------------------------------------------------------

def ensure_backend_runtime_prepared(env: dict | None = None) -> None:
    """确保数据库已初始化。若库不存在则跑一次 runtime_prepare。"""
    api_home = _resolve_configured_app_home()
    db_path = api_home / "data" / "memory_palace.db"
    if db_path.exists() and db_path.stat().st_size > 0:
        return
    print("[i] 数据库未初始化，执行 runtime_prepare（建库 + seed）...")
    backend_env = env or _backend_env()
    log_path = LOGS_DIR / "runtime-prepare.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("ab") as log_file:
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    f"import sys; sys.path.insert(0, {str(API_SRC)!r}); "
                    "from memory_anki.app.runtime_prepare import main; raise SystemExit(main())"
                ),
            ],
            cwd=str(API_DIR),
            env=backend_env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            **hidden_process_kwargs(),
            check=False,
        )
    if result.returncode != 0:
        raise RuntimeError(f"runtime_prepare 失败 ({result.returncode})，详见 {log_path}")


def ensure_backend_migrations_applied(env: dict | None = None) -> None:
    """Run Alembic migrations before uvicorn so health waiting only covers API startup."""
    print("[i] 数据库迁移中...（详见 logs\\runtime-migrate.log）")
    backend_env = env or _backend_env()
    log_path = LOGS_DIR / "runtime-migrate.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("ab") as log_file:
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    f"import sys; sys.path.insert(0, {str(API_SRC)!r}); "
                    "from memory_anki.infrastructure.db.migrations import run_migrations; run_migrations()"
                ),
            ],
            cwd=str(API_DIR),
            env=backend_env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            **hidden_process_kwargs(),
            check=False,
        )
    if result.returncode != 0:
        raise RuntimeError(f"数据库迁移失败 ({result.returncode})，详见 {log_path}")
    print("[ok] 数据库迁移已完成。")


def _runtime_config():
    return load_local_runtime_config()


def _resolve_configured_app_home() -> Path:
    return _runtime_config().local_app_home


def _backend_env() -> dict:
    """后端环境：从 local-config 解析 MEMORY_ANKI_HOME，不设 WEB_DIST（纯 API）。"""
    env = os.environ.copy()
    env["MEMORY_ANKI_HOME"] = str(_resolve_configured_app_home())
    env.pop("MEMORY_ANKI_WEB_DIST", None)
    env.pop("MEMORY_ANKI_RUNTIME_SNAPSHOT", None)
    env["MEMORY_ANKI_STARTUP_MODE"] = "serve"
    env["MEMORY_ANKI_CHANNEL"] = "dev"
    env["PYTHONPATH"] = str(API_SRC)
    return env


# ---------------------------------------------------------------------------
# 启动器
# ---------------------------------------------------------------------------

def _resolve_node() -> str:
    node = shutil.which("node")
    if node:
        return node
    raise RuntimeError("未找到 Node.js，请确认 node 已加入 PATH。")


def _resolve_npm() -> str:
    for candidate in ("npm.cmd", "npm"):
        found = shutil.which(candidate)
        if found:
            return found
    raise RuntimeError("未找到 npm，请确认 npm 已加入 PATH。")


def start_backend() -> subprocess.Popen:
    print(f"[i] 启动后端 uvicorn → http://{BACKEND_HOST}:{BACKEND_PORT}")
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    api_log = LOGS_DIR / "api.log"
    env = _backend_env()
    cmd = [
        sys.executable, "-m", "uvicorn",
        "--app-dir", str(API_SRC),
        "memory_anki.app.main:app",
        "--host", BACKEND_HOST,
        "--port", str(BACKEND_PORT),
    ]
    log_file = api_log.open("ab")
    proc = subprocess.Popen(
        cmd,
        cwd=str(API_DIR),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        **hidden_process_kwargs(),
        close_fds=False,
    )
    return proc


def start_frontend() -> subprocess.Popen:
    print(f"[i] 启动前端 vite dev → http://{BACKEND_HOST}:{FRONTEND_PORT}")
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    web_log = LOGS_DIR / "web-dev.log"
    npm = _resolve_npm()
    cmd = [
        npm,
        "run",
        "dev",
        "--",
        "--host",
        BACKEND_HOST,
        "--port",
        str(FRONTEND_PORT),
        "--strictPort",
    ]
    log_file = web_log.open("ab")
    # 前端需要可见的控制台输出（vite 日志），但仍隐藏额外弹窗
    env = os.environ.copy()
    proc = subprocess.Popen(
        cmd,
        cwd=str(WEB_DIR),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        **hidden_process_kwargs(),
        close_fds=False,
    )
    return proc


def stop_all() -> int:
    """停止后端 (8012) 和前端 (5173) 进程。"""
    print("[i] 停止 Memory Anki 服务 ...")
    free_port(BACKEND_PORT, "后端")
    free_port(FRONTEND_PORT, "前端")
    kill_memory_anki_desktop_processes()
    result = sync_after_stop()
    if not result:
        return 1
    print("[ok] 已停止。")
    return 0


def sync_before_start() -> bool:
    config = _runtime_config()
    if not config.sync_enabled:
        print(f"[i] 本机同步未启用（配置文件: {config.config_path}）。")
        return True
    print(f"[i] 启动前同步检查 → {config.sync_root}")
    result = pull_on_start(config)
    prefix = "[ok]" if result.ok else "[!]"
    print(f"{prefix} {result.message}")
    return result.ok


def sync_after_stop() -> bool:
    config = _runtime_config()
    if not config.sync_enabled:
        print(f"[i] 本机同步未启用（配置文件: {config.config_path}）。")
        return True
    print(f"[i] 停止后同步推送 → {config.sync_root}")
    result = push_on_stop(config)
    prefix = "[ok]" if result.ok else "[!]"
    print(f"{prefix} {result.message}")
    return result.ok


def main() -> int:
    if "--stop" in sys.argv:
        return stop_all()

    # 1. 清理可能残留的端口
    free_port(BACKEND_PORT, "后端")
    free_port(FRONTEND_PORT, "前端")

    # 2. 启动前从云盘拉取更新（如已启用）
    if not sync_before_start():
        return 1

    # 3. 确保数据库就绪
    try:
        ensure_backend_runtime_prepared()
        ensure_backend_migrations_applied()
    except Exception as exc:
        print(f"[!] 数据库准备失败: {exc}")
        return 1

    # 4. 启动后端并等待健康
    backend_proc = start_backend()
    print("[i] 等待后端就绪 ...", end=" ", flush=True)
    if not wait_for_backend(timeout_seconds=120):
        print("超时")
        print(f"[!] 后端 120 秒内未就绪，详见 {LOGS_DIR / 'api.log'}")
        kill_process_tree(backend_proc.pid)
        return 1
    print("就绪 ✓")

    # 5. 启动前端并等待端口监听
    frontend_proc = start_frontend()
    print("[i] 等待前端就绪 ...", end=" ", flush=True)
    if not wait_for_frontend(timeout_seconds=40):
        print("超时")
        print(f"[!] 前端 40 秒内未就绪，详见 {LOGS_DIR / 'web-dev.log'}")
        kill_process_tree(backend_proc.pid)
        kill_process_tree(frontend_proc.pid)
        return 1
    print("就绪 ✓")

    # 6. 打开浏览器
    print(f"[ok] 启动完成，打开 {FRONTEND_URL}")
    try:
        webbrowser.open(FRONTEND_URL)
    except Exception:
        pass

    print()
    print("  前端 (vite dev, HMR 已关闭): " + FRONTEND_URL)
    print(f"  后端 (API): http://{BACKEND_HOST}:{BACKEND_PORT}")
    print(f"  日志: {LOGS_DIR / 'api.log'} / {LOGS_DIR / 'web-dev.log'}")
    print("  停止所有服务: 运行 stop.bat")
    print()
    print("  提示：改前端代码后，在浏览器按 F5 手动刷新即可看到更新（不会自动刷新打断）。")
    print("        改后端代码后，重跑 start.bat 以重启服务。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[i] 已取消。")
        raise SystemExit(130)
