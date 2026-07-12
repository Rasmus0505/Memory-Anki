from __future__ import annotations

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


def test_start_reuses_healthy_shared_service():
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server.dev_server, "list_listening_pids", return_value=[42]),
        patch.object(pwa_server, "_is_memory_anki_service_process", return_value=True),
        patch.object(pwa_server, "_pwa_is_ready", return_value=True),
        patch.object(pwa_server, "_start_backend") as start_backend,
        patch.object(pwa_server, "_supervise") as supervise,
    ):
        assert pwa_server.start() == 0

    start_backend.assert_not_called()
    supervise.assert_not_called()


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


def test_stale_pid_file_does_not_trust_unrelated_windows_process(tmp_path):
    pid_file = tmp_path / "pwa-server.pid"
    pid_file.write_text("99", encoding="utf-8")
    with (
        patch.object(pwa_server, "PWA_PID_FILE", pid_file),
        patch.object(pwa_server.os, "name", "nt"),
        patch.object(pwa_server, "_process_command_line", return_value="unrelated.exe"),
    ):
        assert pwa_server._is_memory_anki_service_process(99) is False


def test_desktop_restart_syncs_and_leaves_shared_service_running():
    process = SimpleNamespace(pid=1234)
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server, "_stop_service_unlocked", return_value=True) as stop_service,
        patch.object(pwa_server.dev_server, "sync_before_start", return_value=True) as sync,
        patch.object(pwa_server, "_pwa_dist_ready", return_value=True),
        patch.object(pwa_server, "_prepare_runtime", return_value=True) as prepare_runtime,
        patch.object(pwa_server, "_start_backend", return_value=process) as start_backend,
        patch.object(pwa_server, "_wait_for_pwa", return_value=True),
        patch.object(pwa_server.dev_server, "kill_process_tree") as kill_process,
    ):
        assert pwa_server.restart_for_desktop() == 0

    stop_service.assert_called_once_with()
    sync.assert_called_once_with()
    prepare_runtime.assert_called_once_with()
    start_backend.assert_called_once_with()
    kill_process.assert_not_called()


def test_desktop_stop_holds_service_lock_through_sync_push():
    with (
        patch.object(pwa_server, "service_lock", return_value=nullcontext()),
        patch.object(pwa_server, "_stop_service_unlocked", return_value=True) as stop_service,
        patch.object(pwa_server.dev_server, "sync_after_stop", return_value=True) as sync,
    ):
        assert pwa_server.stop_for_desktop_sync() == 0

    stop_service.assert_called_once_with()
    sync.assert_called_once_with()


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
        patch.object(pwa_server, "_database_at_alembic_head", return_value=True),
        patch.object(pwa_server, "_stop_service_unlocked") as stop_service,
        patch.object(pwa_server, "_run_frontend_build") as build,
        patch.object(pwa_server.dev_server, "sync_after_stop") as sync,
    ):
        assert pwa_server.prepare() == 0

    stop_service.assert_not_called()
    build.assert_not_called()
    sync.assert_not_called()



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
        patch.object(pwa_server.dev_server, "sync_after_stop", return_value=True),
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
        patch.object(pwa_server.dev_server, "sync_after_stop", return_value=True),
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
        patch.object(pwa_server.dev_server, "sync_after_stop", return_value=True),
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


def test_all_batch_entrypoints_use_diagnostic_runner():
    batch_paths = [
        ROOT / "start-desktop.bat",
        ROOT / "start-pwa.bat",
        TOOLS_DIR / "configure-tailscale-pwa.bat",
        TOOLS_DIR / "install-pwa-autostart.bat",
        TOOLS_DIR / "stop-pwa.bat",
        TOOLS_DIR / "stop.bat",
        TOOLS_DIR / "uninstall-pwa-autostart.bat",
    ]

    for path in batch_paths:
        assert "run_with_diagnostics.ps1" in path.read_text(encoding="utf-8"), path


def test_start_entrypoints_prepare_before_launching():
    pwa = (ROOT / "start-pwa.bat").read_text(encoding="utf-8")
    desktop = (ROOT / "start-desktop.bat").read_text(encoding="utf-8")

    assert 'pwa_launcher.ps1" Update' in pwa
    assert pwa.index('pwa_launcher.ps1" Update') < pwa.index('pwa_launcher.ps1" Start')
    assert 'pwa_launcher.ps1" Update' in desktop
    assert desktop.index('pwa_launcher.ps1" Update') < desktop.index('desktop_launcher.ps1" -ChildSta Start')
    assert not (ROOT / "update.bat").exists()

def test_diagnostic_runner_writes_fixed_ai_debug_artifacts():
    runner = (TOOLS_DIR / "run_with_diagnostics.ps1").read_text(encoding="utf-8")

    assert "last-launch-error.log" in runner
    assert "last-launch-status.json" in runner
    assert "launch-history.log" in runner
    assert 'State "running"' in runner
    assert "exit_code" in runner
    assert "git_commit" in runner


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


def test_manual_batch_start_shows_backend_console():
    desktop_batch = (ROOT / "start-desktop.bat").read_text(encoding="utf-8")
    pwa_batch = (ROOT / "start-pwa.bat").read_text(encoding="utf-8")
    launcher = (TOOLS_DIR / "pwa_launcher.ps1").read_text(encoding="utf-8")

    assert "-WindowStyle Hidden" not in desktop_batch
    assert "start " not in desktop_batch.lower()
    assert "pwa_launcher.ps1" in pwa_batch
    assert "-WindowStyle Hidden" not in pwa_batch
    assert 'MEMORY_ANKI_VISIBLE_BACKEND = "1"' in launcher
    assert "-WindowStyle Hidden" not in launcher


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
    assert '"start-pwa.bat", "--smoke-test"' in launcher_smoke
    assert '"start-desktop.bat"' in launcher_smoke
    assert "OPENAPI_URL" in launcher_smoke
    assert "_electron_pids" in launcher_smoke


def test_agent_rules_require_launcher_smoke_for_runtime_changes():
    rules = (ROOT / "AGENTS.md").read_text(encoding="utf-8")

    assert "python tools/quality_gate.py --launchers" in rules
    assert "start-pwa.bat" in rules
    assert "start-desktop.bat" in rules
