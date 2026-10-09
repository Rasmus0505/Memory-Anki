from __future__ import annotations

import ast
import inspect
import json
import os
import sys
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import pwa_server  # noqa: E402


def _write_release_artifacts(
    web_dist: Path,
    *,
    release_assets: list[str],
    precache_assets: list[str] | None = None,
) -> None:
    release_id = "release-test"
    (web_dist / "assets").mkdir(parents=True)
    (web_dist / "releases").mkdir()
    for asset in release_assets:
        (web_dist / asset).write_text("asset", encoding="utf-8")
    (web_dist / "release.json").write_text(
        json.dumps({"releaseId": release_id}), encoding="utf-8"
    )
    (web_dist / "releases" / f"{release_id}.json").write_text(
        json.dumps({"files": release_assets}), encoding="utf-8"
    )
    index_asset = release_assets[0]
    (web_dist / "index.html").write_text(
        f'<meta name="memory-anki-release" content="{release_id}"><script src="/{index_asset}"></script>',
        encoding="utf-8",
    )
    (web_dist / "manifest.webmanifest").write_text("{}", encoding="utf-8")
    (web_dist / "offline.html").write_text("offline", encoding="utf-8")
    precache = precache_assets if precache_assets is not None else [f"/{asset}" for asset in release_assets]
    (web_dist / "sw.js").write_text(
        f"const RELEASE_ID = '{release_id}'\n"
        f"const PRECACHE_RELEASE_ASSETS = {json.dumps(precache)}\n"
        "// release assets injected by the build\n",
        encoding="utf-8",
    )


def test_start_reuses_healthy_shared_service():
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server.dev_server, "list_listening_pids", return_value=[42]),
        patch.object(pwa_server, "_is_memory_anki_service_process", return_value=True),
        patch.object(pwa_server, "_service_belongs_to_this_checkout", return_value=True),
        patch.object(pwa_server, "_running_service_uses_configured_home", return_value=True),
        patch.object(pwa_server, "_pwa_is_ready", return_value=True),
        patch.object(pwa_server, "_database_at_alembic_head", return_value=True),
        patch.object(pwa_server, "_start_backend") as start_backend,
        patch.object(pwa_server, "_supervise") as supervise,
    ):
        assert pwa_server.start() == 0

    start_backend.assert_not_called()
    supervise.assert_not_called()


def test_start_restarts_healthy_service_when_database_is_behind_head():
    process = SimpleNamespace(pid=1234)
    call_order: list[str] = []
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server.dev_server, "list_listening_pids", return_value=[42]),
        patch.object(pwa_server, "_is_memory_anki_service_process", return_value=True),
        patch.object(pwa_server, "_service_belongs_to_this_checkout", return_value=True),
        patch.object(pwa_server, "_running_service_uses_configured_home", return_value=True),
        patch.object(pwa_server, "_pwa_is_ready", return_value=True),
        patch.object(pwa_server, "_database_at_alembic_head", return_value=False),
        patch.object(
            pwa_server,
            "_stop_service_unlocked",
            side_effect=lambda: call_order.append("stop") or True,
        ),
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(
            pwa_server,
            "_prepare_runtime",
            side_effect=lambda: call_order.append("prepare") or True,
        ),
        patch.object(
            pwa_server,
            "_start_backend",
            side_effect=lambda: call_order.append("start") or process,
        ),
        patch.object(pwa_server, "_wait_for_pwa", return_value=True),
    ):
        assert pwa_server.start(supervise=False) == 0

    assert call_order == ["stop", "prepare", "start"]


def test_release_validation_requires_every_current_asset_in_service_worker_precache(tmp_path):
    web_dist = tmp_path / "dist"
    release_assets = [
        "assets/main.js",
        "assets/ImmersiveFreestylePage.js",
        "assets/PalaceEditPage-legacyhash.js",
    ]
    _write_release_artifacts(web_dist, release_assets=release_assets)

    with patch.object(pwa_server, "WEB_DIST", web_dist):
        assert pwa_server._validate_web_release() is True


def test_release_validation_rejects_a_partial_service_worker_precache(tmp_path):
    web_dist = tmp_path / "dist"
    release_assets = ["assets/main.js", "assets/ImmersiveFreestylePage.js"]
    _write_release_artifacts(
        web_dist,
        release_assets=release_assets,
        precache_assets=["/assets/main.js"],
    )

    with patch.object(pwa_server, "WEB_DIST", web_dist):
        assert pwa_server._validate_web_release() is False


def test_pwa_dist_readiness_rejects_a_partial_service_worker_precache(tmp_path):
    web_dist = tmp_path / "dist"
    _write_release_artifacts(
        web_dist,
        release_assets=["assets/main.js", "assets/InsightsPage.js"],
        precache_assets=["/assets/main.js"],
    )

    with patch.object(pwa_server, "WEB_DIST", web_dist):
        assert pwa_server._pwa_dist_ready() is False


def test_start_prepares_migrations_before_starting_backend():
    process = SimpleNamespace(pid=1234)
    call_order: list[str] = []
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server.dev_server, "list_listening_pids", return_value=[]),
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_prepare_runtime", side_effect=lambda: call_order.append("prepare") or True),
        patch.object(pwa_server, "_start_backend", side_effect=lambda: call_order.append("start") or process),
        patch.object(pwa_server, "_wait_for_pwa", return_value=True),
    ):
        assert pwa_server.start(supervise=False) == 0

    assert call_order == ["prepare", "start"]


def test_wait_for_pwa_returns_immediately_when_child_exits():
    process = SimpleNamespace(poll=lambda: 1)
    with patch.object(pwa_server.dev_server, "wait_for_backend") as wait_for_backend:
        assert pwa_server._wait_for_pwa(timeout_seconds=120, process=process) is False

    wait_for_backend.assert_not_called()


def test_start_rejects_non_memory_anki_port_owner():
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server.dev_server, "list_listening_pids", return_value=[99]),
        patch.object(pwa_server, "_is_memory_anki_service_process", return_value=False),
        patch.object(pwa_server, "_start_backend") as start_backend,
    ):
        assert pwa_server.start(supervise=False) == 1

    start_backend.assert_not_called()


def _code_without_docstrings(func) -> str:
    """Source of ``func`` with its docstring removed.

    The docstrings deliberately explain which WMI call used to hang here, so only
    executable code should be searched for forbidden APIs.
    """
    tree = ast.parse(inspect.getsource(func))
    node = tree.body[0]
    if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.body:
        first = node.body[0]
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
            if isinstance(first.value.value, str):
                node.body = node.body[1:] or [ast.Pass()]
    return ast.unparse(tree)


def test_sqlalchemy_import_does_not_wait_on_windows_wmi():
    """SQLAlchemy calls platform.machine() at import, and that WMI query never times out.

    A spinning WMI provider froze pwa_server --prepare on the service lock, so
    start-all.bat stayed on "Checking for updates...". Importing the package
    must take the registry fallback before any SQLAlchemy import.
    """
    import subprocess

    script = """
import platform

class _Hang:
    def exec_query(self, query):
        raise SystemExit("wmi was queried: " + query)

platform._wmi = _Hang()
import memory_anki
assert platform._wmi is None
import sqlalchemy
print(platform.machine())
"""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT / "apps" / "api" / "src")
    env.pop("PYTHONSTARTUP", None)
    completed = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=20,
        env=env,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip()
    assert "wmi was queried" not in completed.stderr


def test_pwa_server_disables_wmi_before_alembic_import():
    import subprocess

    script = """
import os
import sys
from pathlib import Path
root = Path(os.environ["MEMORY_ANKI_TEST_ROOT"])
sys.path.insert(0, str(root / "tools"))
sys.path.insert(0, str(root / "apps" / "api" / "src"))
import platform

class _Hang:
    def exec_query(self, query):
        raise SystemExit("wmi was queried: " + query)

platform._wmi = _Hang()
import pwa_server
assert platform._wmi is None
print("ok")
"""
    env = os.environ.copy()
    env["MEMORY_ANKI_TEST_ROOT"] = str(ROOT)
    completed = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=20,
        env=env,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "ok"


def test_process_lookup_never_invokes_wmi():
    """A damaged WMI repository blocks `Get-CimInstance` forever instead of failing.

    That froze start-all.bat at "Checking for updates..." with no error and no log,
    so these paths must never shell out to WMI again.
    """
    import dev_server

    producers = [
        dev_server.process_command_lines,
        dev_server.process_command_line,
        dev_server.kill_memory_anki_desktop_processes,
        dev_server.kill_process_tree,
        dev_server.process_tree_pids,
        dev_server.spawn_detached_windows_process,
        dev_server._create_detached_process,
        pwa_server._process_command_line,
    ]
    for func in producers:
        code = _code_without_docstrings(func)
        assert "Get-CimInstance" not in code, func.__name__
        assert "Get-WmiObject" not in code, func.__name__
        assert "wmic" not in code.lower(), func.__name__
        # Shelling out would reintroduce an unbounded external wait.
        assert "powershell" not in code.lower(), func.__name__
        assert "subprocess" not in code, func.__name__


def test_kill_process_tree_stops_a_descendant_without_taskkill(tmp_path: Path):
    """taskkill /T hangs on this machine's damaged WMI repository and may not kill."""
    import subprocess
    import time

    import dev_server

    if sys.platform != "win32":
        assert dev_server.process_tree_pids(os.getpid()) == [os.getpid()]
        return

    child_pid_file = tmp_path / "child.pid"
    parent = subprocess.Popen(
        [
            sys.executable,
            "-c",
            (
                "import pathlib, subprocess, sys, time\n"
                "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])\n"
                "pathlib.Path(sys.argv[1]).write_text(str(child.pid), encoding='utf-8')\n"
                "time.sleep(120)\n"
            ),
            str(child_pid_file),
        ],
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        deadline = time.monotonic() + 10
        while not child_pid_file.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert child_pid_file.exists(), "child pid file was not written"
        child_pid = int(child_pid_file.read_text(encoding="utf-8"))
        tree = dev_server.process_tree_pids(parent.pid)
        assert child_pid in tree
        assert tree[-1] == parent.pid
        started = time.monotonic()
        dev_server.kill_process_tree(parent.pid)
        parent.wait(timeout=5)
        assert time.monotonic() - started < 5
        assert parent.returncode is not None
    finally:
        if parent.poll() is None:
            parent.kill()


def test_process_command_lines_is_wmi_free_and_tolerates_missing_processes():
    import dev_server

    if sys.platform != "win32":
        assert dev_server.process_command_lines() == {}
        return
    # Enumerating must be fast and must not raise when processes exit mid-scan.
    processes = dev_server.process_command_lines()
    assert isinstance(processes, dict)
    assert all(isinstance(pid, int) and pid > 0 for pid in processes)
    # The current process must appear with a resolvable image path.
    assert os.getpid() in processes


def test_process_command_line_returns_empty_for_dead_or_invalid_pid():
    import dev_server

    assert dev_server.process_command_line(0) == ""
    assert dev_server.process_command_line(-1) == ""
    # A pid that cannot exist must degrade to "" rather than raise or hang.
    assert dev_server.process_command_line(0xFFFFFFF0) == ""


def test_process_command_line_reads_own_command_line():
    import dev_server

    if sys.platform != "win32":
        return
    command_line = dev_server.process_command_line(os.getpid())
    # Either a real command line or a graceful empty read; never an exception.
    assert isinstance(command_line, str)
    if command_line:
        assert "python" in command_line.lower() or "pytest" in command_line.lower()


def test_stale_pid_file_does_not_trust_unrelated_windows_process(tmp_path):
    pid_file = tmp_path / "pwa-server.pid"
    pid_file.write_text("99", encoding="utf-8")
    with (
        patch.object(pwa_server, "PWA_PID_FILE", pid_file),
        patch.object(pwa_server.os, "name", "nt"),
        patch.object(pwa_server, "_process_command_line", return_value="unrelated.exe"),
    ):
        assert pwa_server._is_memory_anki_service_process(99) is False
        assert pwa_server._service_belongs_to_this_checkout(99) is False


def test_process_command_line_lowercases_for_marker_matching():
    """Callers compare lower-case markers, so the helper must lower-case."""
    with patch.object(
        pwa_server.dev_server, "process_command_line", return_value="PYTHON -M UVICORN"
    ) as native:
        result = pwa_server._process_command_line(1234)

    native.assert_called_once_with(1234)
    assert result == "python -m uvicorn"


def test_other_memory_anki_checkout_can_be_replaced(tmp_path):
    pid_file = tmp_path / "pwa-server.pid"
    pid_file.write_text("1", encoding="utf-8")
    other = r"d:\baidusyncdisk\grok-4.7-juiceness\apps\api\src"
    command = f"python -m uvicorn --app-dir {other} memory_anki.app.main:app --port 8012"
    with (
        patch.object(pwa_server, "PWA_PID_FILE", pid_file),
        patch.object(pwa_server.os, "name", "nt"),
        patch.object(pwa_server, "_process_command_line", return_value=command),
    ):
        assert pwa_server._is_memory_anki_service_process(22408) is True
        assert pwa_server._service_belongs_to_this_checkout(22408) is False


def test_start_switches_away_from_another_memory_anki_checkout():
    process = SimpleNamespace(pid=1234, poll=lambda: None)
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server.dev_server, "list_listening_pids", return_value=[22408]),
        patch.object(pwa_server, "_is_memory_anki_service_process", return_value=True),
        patch.object(pwa_server, "_service_belongs_to_this_checkout", return_value=False),
        patch.object(pwa_server, "_stop_service_unlocked", return_value=True) as stop_service,
        patch.object(pwa_server, "_pwa_is_ready", return_value=True),
        patch.object(pwa_server, "_database_at_alembic_head", return_value=True),
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_prepare_runtime", return_value=True),
        patch.object(pwa_server, "_start_backend", return_value=process),
        patch.object(pwa_server, "_wait_for_pwa", return_value=True),
        patch.object(pwa_server.dev_server, "kill_memory_anki_desktop_processes") as kill_desktop,
    ):
        assert pwa_server.start(supervise=False) == 0

    stop_service.assert_called_once_with()
    kill_desktop.assert_called_once_with()


def test_desktop_restart_starts_shared_service():
    process = SimpleNamespace(pid=1234)
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server, "_shared_service_healthy", return_value=False),
        patch.object(pwa_server, "_stop_service_unlocked", return_value=True) as stop_service,
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_prepare_runtime", return_value=True) as prepare_runtime,
        patch.object(pwa_server, "_start_backend", return_value=process) as start_backend,
        patch.object(pwa_server, "_wait_for_pwa", return_value=True),
        patch.object(pwa_server.dev_server, "kill_process_tree") as kill_process,
    ):
        assert pwa_server.restart_for_desktop() == 0

    stop_service.assert_called_once_with()
    prepare_runtime.assert_called_once_with()
    start_backend.assert_called_once_with()
    kill_process.assert_not_called()


def test_desktop_reuses_healthy_service():
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server, "_shared_service_healthy", return_value=True),
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_stop_service_unlocked") as stop_service,
        patch.object(pwa_server, "_start_backend") as start_backend,
    ):
        assert pwa_server.restart_for_desktop() == 0

    stop_service.assert_not_called()
    start_backend.assert_not_called()


def test_fingerprint_uses_metadata_not_file_contents(tmp_path):
    source = tmp_path / "a.txt"
    source.write_text("hello", encoding="utf-8")
    first = pwa_server._fingerprint([source])
    source.write_text("hello-changed", encoding="utf-8")
    # Force mtime change even if filesystem timestamp granularity is coarse.
    os_utime = __import__("os").utime
    os_utime(source, (source.stat().st_mtime + 2, source.stat().st_mtime + 2))
    second = pwa_server._fingerprint([source])
    assert first != second
    assert len(first) == 64


def test_supervise_exits_zero_when_service_taken_over(tmp_path):
    process = SimpleNamespace(returncode=1, poll=lambda: 1)
    reason_file = tmp_path / "pwa-stop-reason.txt"
    reason_file.write_text("requested", encoding="utf-8")
    with (
        patch.object(pwa_server, "PWA_STOP_REASON_FILE", reason_file),
        patch.object(pwa_server.signal, "signal"),
    ):
        assert pwa_server._supervise(process) == 0
    assert not reason_file.exists()


def test_windows_supervisor_leaves_detached_service_running_when_launcher_closes(tmp_path):
    process = SimpleNamespace(returncode=0, poll=lambda: None, pid=1234)
    signal_handlers = {}
    reason_file = tmp_path / "pwa-stop-reason.txt"

    def record_handler(signal_number, handler):
        signal_handlers[signal_number] = handler

    def close_launcher(_seconds):
        signal_handlers[pwa_server.signal.SIGINT](pwa_server.signal.SIGINT, None)

    with (
        patch.object(pwa_server, "PWA_STOP_REASON_FILE", reason_file),
        patch.object(pwa_server.os, "name", "nt"),
        patch.object(pwa_server.signal, "signal", side_effect=record_handler),
        patch.object(pwa_server.time, "sleep", side_effect=close_launcher),
        patch.object(pwa_server.dev_server, "kill_process_tree") as kill_process,
    ):
        assert pwa_server._supervise(process) == 0

    kill_process.assert_not_called()
    assert not reason_file.exists()


def test_desktop_electron_defaults_to_shared_service():
    main_script = (ROOT / "apps" / "desktop-timer" / "main.cjs").read_text(encoding="utf-8")
    desktop_launcher = (TOOLS_DIR / "desktop_timer.py").read_text(encoding="utf-8")

    assert "http://127.0.0.1:8012/" in main_script
    assert "BACKEND_PORT" in desktop_launcher
    assert "start_frontend" not in desktop_launcher
    assert "kill_process_tree(backend" not in desktop_launcher
    assert "kill_memory_anki_desktop_processes" not in desktop_launcher
    assert "requestSingleInstanceLock" in main_script
    assert "new Tray" not in main_script
    assert "ensure_shared_tray()" in desktop_launcher
    assert 'os.environ["MEMORY_ANKI_VISIBLE_BACKEND"] = "1"' in desktop_launcher


def test_prepare_skips_all_work_when_fingerprints_are_current():
    fingerprints = {"frontend": "f", "backend": "b", "migrations": "m"}
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server, "_current_update_fingerprints", return_value=fingerprints),
        patch.object(pwa_server, "_read_update_state", return_value=fingerprints),
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_desktop_runtime_ready", return_value=True),
        patch.object(pwa_server, "_database_at_alembic_head", return_value=True),
        patch.object(pwa_server, "_stop_service_unlocked") as stop_service,
        patch.object(pwa_server, "_run_frontend_build") as build,
    ):
        assert pwa_server.prepare() == 0

    stop_service.assert_not_called()
    build.assert_not_called()



def test_desktop_runtime_installs_lockfile_dependencies_when_electron_package_is_missing(tmp_path):
    web_dir = tmp_path / "web"
    logs_dir = tmp_path / "logs"
    web_dir.mkdir()
    completed = SimpleNamespace(returncode=0)
    with (
        patch.object(pwa_server, "WEB_DIR", web_dir),
        patch.object(pwa_server, "LOGS_DIR", logs_dir),
        patch.object(pwa_server, "_desktop_runtime_ready", side_effect=[False, True]),
        patch.object(pwa_server, "_ensure_electron_launch_integrity", return_value=True),
        patch.object(pwa_server.dev_server, "_resolve_npm", return_value="npm.cmd"),
        patch.object(pwa_server.dev_server, "hidden_process_kwargs", return_value={}),
        patch.object(pwa_server.subprocess, "run", return_value=completed) as run,
    ):
        assert pwa_server._ensure_desktop_runtime() is True

    assert run.call_args.args[0] == [
        "npm.cmd",
        "ci",
        "--include=dev",
        "--foreground-scripts",
    ]


def test_desktop_runtime_rebuilds_installed_electron_package(tmp_path):
    web_dir = tmp_path / "web"
    logs_dir = tmp_path / "logs"
    electron_dir = web_dir / "node_modules" / "electron"
    electron_dir.mkdir(parents=True)
    (electron_dir / "package.json").write_text("{}", encoding="utf-8")
    completed = SimpleNamespace(returncode=0)
    with (
        patch.object(pwa_server, "WEB_DIR", web_dir),
        patch.object(pwa_server, "LOGS_DIR", logs_dir),
        patch.object(pwa_server, "_desktop_runtime_ready", side_effect=[False, True]),
        patch.object(pwa_server, "_ensure_electron_launch_integrity", return_value=True),
        patch.object(pwa_server.dev_server, "_resolve_npm", return_value="npm.cmd"),
        patch.object(pwa_server.dev_server, "hidden_process_kwargs", return_value={}),
        patch.object(pwa_server.subprocess, "run", return_value=completed) as run,
    ):
        assert pwa_server._ensure_desktop_runtime() is True

    assert run.call_args.args[0] == [
        "npm.cmd",
        "rebuild",
        "electron",
        "--foreground-scripts",
    ]


def test_desktop_runtime_restores_low_integrity_without_reinstall():
    with (
        patch.object(pwa_server, "_desktop_runtime_ready", return_value=True),
        patch.object(pwa_server, "_ensure_electron_launch_integrity", return_value=True) as repair,
        patch.object(pwa_server.subprocess, "run") as run,
    ):
        assert pwa_server._ensure_desktop_runtime() is True

    repair.assert_called_once_with()
    run.assert_not_called()


def test_low_integrity_electron_is_raised_to_medium(tmp_path):
    web_dir = tmp_path / "web"
    executable = web_dir / "node_modules" / "electron" / "dist" / "electron.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"")
    state = {"repaired": False}
    completed = SimpleNamespace(returncode=0, stdout="processed file", stderr="")

    def fake_run(command, **kwargs):
        state["repaired"] = True
        return completed

    with (
        patch.object(pwa_server, "WEB_DIR", web_dir),
        patch.object(pwa_server.os, "name", "nt"),
        patch.object(
            pwa_server,
            "_file_integrity_rid",
            side_effect=lambda _path: 0x2000 if state["repaired"] else 0x1000,
        ),
        patch.object(pwa_server, "_icacls_executable", return_value=r"C:\Windows\System32\icacls.exe"),
        patch.object(pwa_server.dev_server, "hidden_console_kwargs", return_value={}),
        patch.object(pwa_server.subprocess, "run", side_effect=fake_run) as run,
    ):
        assert pwa_server._ensure_electron_launch_integrity() is True

    assert run.call_args.args[0] == [
        r"C:\Windows\System32\icacls.exe",
        str(executable.parent),
        "/setintegritylevel",
        "(OI)(CI)M",
        "/T",
    ]


def test_medium_integrity_electron_is_left_unchanged(tmp_path):
    web_dir = tmp_path / "web"
    executable = web_dir / "node_modules" / "electron" / "dist" / "electron.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"")
    with (
        patch.object(pwa_server, "WEB_DIR", web_dir),
        patch.object(pwa_server.os, "name", "nt"),
        patch.object(pwa_server, "_file_integrity_rid", return_value=0x2000),
        patch.object(pwa_server.subprocess, "run") as run,
    ):
        assert pwa_server._ensure_electron_launch_integrity() is True

    run.assert_not_called()


def test_prepare_repairs_missing_desktop_runtime():
    fingerprints = {"frontend": "f", "backend": "b", "migrations": "m"}
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server, "_current_update_fingerprints", return_value=fingerprints),
        patch.object(pwa_server, "_read_update_state", return_value=fingerprints),
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_desktop_runtime_ready", return_value=False),
        patch.object(pwa_server, "_database_at_alembic_head", return_value=True),
        patch.object(pwa_server.dev_server, "kill_memory_anki_desktop_processes"),
        patch.object(pwa_server.dev_server, "free_port"),
        patch.object(pwa_server, "_stop_service_unlocked", return_value=True),
        patch.object(pwa_server, "_ensure_desktop_runtime", return_value=True) as repair,
        patch.object(pwa_server, "_ensure_runtime_initialized", return_value=True),
        patch.object(pwa_server, "_write_update_state") as write_state,
    ):
        assert pwa_server.prepare() == 0

    repair.assert_called_once_with()
    write_state.assert_called_once_with(fingerprints)


def test_prepare_only_builds_changed_frontend_and_records_success():
    current = {"frontend": "new", "backend": "same", "migrations": "same"}
    previous = {"frontend": "old", "backend": "same", "migrations": "same"}
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server, "_current_update_fingerprints", return_value=current),
        patch.object(pwa_server, "_read_update_state", return_value=previous),
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_database_at_alembic_head", return_value=True),
        patch.object(pwa_server.dev_server, "kill_memory_anki_desktop_processes"),
        patch.object(pwa_server.dev_server, "free_port"),
        patch.object(pwa_server, "_stop_service_unlocked", return_value=True),
        patch.object(pwa_server, "_run_frontend_build", return_value=True) as build,
        patch.object(pwa_server, "_ensure_runtime_initialized", return_value=True),
        patch.object(pwa_server.dev_server, "ensure_backend_migrations_applied") as migrate,
        patch.object(pwa_server, "_write_update_state") as write_state,
    ):
        assert pwa_server.prepare() == 0

    build.assert_called_once_with()
    migrate.assert_not_called()
    write_state.assert_called_once_with(current)


def test_prepare_does_not_record_state_after_build_failure():
    current = {"frontend": "new", "backend": "same", "migrations": "same"}
    previous = {"frontend": "old", "backend": "same", "migrations": "same"}
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server, "_current_update_fingerprints", return_value=current),
        patch.object(pwa_server, "_read_update_state", return_value=previous),
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_database_at_alembic_head", return_value=True),
        patch.object(pwa_server.dev_server, "kill_memory_anki_desktop_processes"),
        patch.object(pwa_server.dev_server, "free_port"),
        patch.object(pwa_server, "_stop_service_unlocked", return_value=True),
        patch.object(pwa_server, "_run_frontend_build", return_value=False),
        patch.object(pwa_server, "_write_update_state") as write_state,
    ):
        assert pwa_server.prepare() == 1

    write_state.assert_not_called()


def test_shared_tray_contract_has_one_mutex_and_no_visible_port():
    tray_script = (TOOLS_DIR / "pwa_tray.ps1").read_text(encoding="utf-8")

    assert "MemoryAnkiPwaTray" in tray_script
    assert "New-MemoryAnkiTrayIcon" in tray_script
    assert "Open Memory Anki" in tray_script
    assert "本机地址" not in tray_script
    assert "Shared service is ready" in tray_script


def test_pwa_launcher_uses_lightweight_python_probe():
    launcher = (TOOLS_DIR / "pwa_launcher.ps1").read_text(encoding="utf-8")

    assert 'ProbeCode "import sys"' in launcher
    assert "pydantic_settings" not in launcher


def test_pwa_launcher_preserves_native_python_exit_code():
    launcher = (TOOLS_DIR / "pwa_launcher.ps1").read_text(encoding="utf-8")

    assert "$script:PwaServerExitCode = $exitCode" in launcher
    assert "exit $script:PwaServerExitCode" in launcher
    assert "return $exitCode" not in launcher
    assert "exit (Invoke-PwaServer" not in launcher


def test_desktop_launch_rechecks_and_repairs_electron_runtime():
    desktop_timer = (TOOLS_DIR / "desktop_timer.py").read_text(encoding="utf-8")

    assert "pwa_server._ensure_desktop_runtime()" in desktop_timer
    assert "Electron runtime repair failed" in desktop_timer
    assert 'env.pop("ELECTRON_RUN_AS_NODE", None)' in desktop_timer
    assert "pwa_server._electron_executable()" in desktop_timer
    assert '"desktop:timer"' not in desktop_timer
    assert "_ensure_electron_launch_integrity()" in (TOOLS_DIR / "pwa_server.py").read_text(encoding="utf-8")


def test_all_batch_entrypoints_use_diagnostic_runner():
    batch_paths = [
        ROOT / "start-all.bat",
        TOOLS_DIR / "configure-tailscale-pwa.bat",
        TOOLS_DIR / "install-pwa-autostart.bat",
        ROOT / "stop.bat",
        TOOLS_DIR / "uninstall-pwa-autostart.bat",
    ]

    for path in batch_paths:
        assert "run_with_diagnostics.ps1" in path.read_text(encoding="utf-8"), path


def test_start_entrypoints_prepare_before_launching():
    launcher = (ROOT / "start-all.bat").read_text(encoding="utf-8-sig")

    # Double-click defaults to both: shared update, then PWA + Desktop.
    assert 'pwa_launcher.ps1" Update' in launcher
    assert 'pwa_launcher.ps1" Start' in launcher
    assert 'desktop_launcher.ps1" -ChildSta Start' in launcher
    assert "choice" not in launcher.lower()
    assert "Select mode" not in launcher
    assert launcher.index('pwa_launcher.ps1" Update') < launcher.index('pwa_launcher.ps1" Start')
    assert launcher.index('pwa_launcher.ps1" Update') < launcher.index('desktop_launcher.ps1" -ChildSta Start')
    assert launcher.index('pwa_launcher.ps1" Start') < launcher.index('desktop_launcher.ps1" -ChildSta Start')
    assert not (ROOT / "update.bat").exists()

def test_diagnostic_runner_writes_fixed_ai_debug_artifacts():
    runner = (TOOLS_DIR / "run_with_diagnostics.ps1").read_text(encoding="utf-8")

    assert "last-launch-error.log" in runner
    assert "last-launch-status.json" in runner
    assert "launch-history.log" in runner
    assert 'State "running"' in runner
    assert "exit_code" in runner
    assert "git_commit" in runner
    assert "git status --porcelain" not in runner


def test_diagnostic_runner_does_not_promote_child_stderr_to_wrapper_failure():
    runner = (TOOLS_DIR / "run_with_diagnostics.ps1").read_text(encoding="utf-8")

    invocation = runner.index("& powershell.exe @childArgs 2>&1")
    relaxed_errors = runner.rindex('$ErrorActionPreference = "Continue"', 0, invocation)
    restored_errors = runner.index(
        "$ErrorActionPreference = $previousErrorActionPreference", invocation
    )

    assert relaxed_errors < invocation < restored_errors


def test_tray_and_autostart_launch_shared_service_through_diagnostic_runner():
    tray = (TOOLS_DIR / "pwa_tray.ps1").read_text(encoding="utf-8")
    launcher = (TOOLS_DIR / "pwa_launcher.ps1").read_text(encoding="utf-8")

    assert "run_with_diagnostics.ps1" in tray
    assert '"-Name", "pwa-service"' in tray
    assert "Write-Output $_" in launcher
    assert "pwa-autostart" in launcher
    assert 'ScriptPath `"$launcherPath`" Start -ConfigureServe' in launcher


def test_manual_batch_start_keeps_launcher_console_visible():
    batch = (ROOT / "start-all.bat").read_text(encoding="utf-8-sig")
    launcher = (TOOLS_DIR / "pwa_launcher.ps1").read_text(encoding="utf-8")

    assert "-WindowStyle Hidden" not in batch
    # PWA is detached so Desktop can continue in the same console.
    assert batch.lower().count('start "memory anki pwa"') == 1
    assert "pwa_launcher.ps1" in batch
    assert "desktop_launcher.ps1" in batch
    assert 'MEMORY_ANKI_VISIBLE_BACKEND = "1"' in launcher
    assert "-WindowStyle Hidden" not in launcher


def test_windows_electron_disables_gpu_before_ready():
    electron_main = (ROOT / "apps" / "desktop-timer" / "main.cjs").read_text(encoding="utf-8")
    gpu_guard = electron_main.split("const READY_FILE", 1)[1].split("let mainWindow", 1)[0]

    assert "must run under Electron" in electron_main
    assert "disableHardwareAcceleration()" in gpu_guard
    assert "disable-gpu" in gpu_guard
    assert "setPath('userData'" in electron_main
    assert "electron-user-data" in electron_main
    assert electron_main.index("setPath('userData'") < electron_main.index("requestSingleInstanceLock()")
    assert gpu_guard.index("disableHardwareAcceleration()") < electron_main.index("app.whenReady()")


def test_hidden_desktop_timer_overlay_is_not_kept_on_screen():
    electron_main = (ROOT / "apps" / "desktop-timer" / "main.cjs").read_text(encoding="utf-8")
    ready = electron_main.split("function writeDesktopReady()", 1)[1].split("\n}\n", 1)[0]
    startup = electron_main.split("app.whenReady().then", 1)[1].split("ipcMain.on", 1)[0]

    assert "timerWindowLoaded" not in ready
    assert "createTimerWindow()" not in startup
    assert "function destroyTimerWindow()" in electron_main
    assert "TIMER_OFFSCREEN" in electron_main
    assert "closing.hide()" in electron_main


def test_desktop_launcher_detaches_after_electron_ready_signal():
    desktop_timer = (TOOLS_DIR / "desktop_timer.py").read_text(encoding="utf-8")
    electron_main = (ROOT / "apps" / "desktop-timer" / "main.cjs").read_text(encoding="utf-8")

    assert 'env["MEMORY_ANKI_DESKTOP_READY_FILE"]' in desktop_timer
    assert "pwa_server._electron_executable()" in desktop_timer
    assert 'str(REPO_ROOT / "apps" / "desktop-timer" / "main.cjs")' in desktop_timer
    assert "--disable-gpu" not in desktop_timer
    assert "process = subprocess.Popen(" in desktop_timer
    assert "ready_path.is_file()" in desktop_timer
    assert "ready signal after process exit" in desktop_timer
    assert 'log_file = log_path.open("a", encoding="utf-8")' in desktop_timer
    assert "log_file.close()" in desktop_timer
    assert "subprocess.run(" not in desktop_timer
    assert "MEMORY_ANKI_DESKTOP_READY_FILE" in electron_main
    assert "writeDesktopReady()" in electron_main
    assert "reusedExistingInstance" in electron_main
    assert "hasSingleInstanceLock" in electron_main


def test_shared_backend_never_inherits_launcher_diagnostic_pipe():
    pwa_source = (TOOLS_DIR / "pwa_server.py").read_text(encoding="utf-8")

    assert 'log_file = log_path.open("ab")' in pwa_source
    assert "stdout=log_file" in pwa_source
    assert "stderr=subprocess.STDOUT" in pwa_source
    assert "stdin=subprocess.DEVNULL" in pwa_source


def test_windows_python_launcher_waits_for_direct_process_only():
    runtime = (TOOLS_DIR / "windows_runtime.ps1").read_text(encoding="utf-8")

    assert "[System.Diagnostics.ProcessStartInfo]::new()" in runtime
    assert "$process.WaitForExit()" in runtime
    assert "return $process.ExitCode" in runtime


def test_retired_0022_revision_remains_available_for_existing_databases():
    migration = ROOT / "apps" / "api" / "alembic" / "versions" / "0022_preserve_retired_mindmap_preferences.py"
    source = migration.read_text(encoding="utf-8")

    assert 'revision = "0022_preserve_retired_mindmap_preferences"' in source
    assert 'down_revision = "0021_remove_mindmap_view_preferences"' in source
def test_quality_gate_exposes_real_launcher_smoke_option():
    quality_gate = (TOOLS_DIR / "quality_gate.py").read_text(encoding="utf-8")
    launcher_smoke = (TOOLS_DIR / "launcher_smoke.py").read_text(encoding="utf-8")

    assert '"--launchers"' in quality_gate
    assert 'QualityStep("Windows launcher smoke"' in quality_gate
    assert '"start-all.bat", "--smoke-test"' in launcher_smoke
    assert '"start-all.bat", "--desktop"' in launcher_smoke
    assert "OPENAPI_URL" in launcher_smoke
    assert "_electron_pids" in launcher_smoke


def test_agent_rules_require_launcher_smoke_for_runtime_changes():
    rules = (ROOT / "AGENTS.md").read_text(encoding="utf-8")

    assert "python tools/quality_gate.py --launchers" in rules
    assert "start-all.bat" in rules
