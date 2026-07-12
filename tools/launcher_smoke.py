from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OPENAPI_URL = "http://127.0.0.1:8012/openapi.json"
STATUS_PATH = REPO_ROOT / "logs" / "launch-status" / "desktop.json"


def _wait_for_openapi(timeout_seconds: float = 120) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(OPENAPI_URL, timeout=3) as response:
                if response.status == 200 and "application/json" in response.headers.get("Content-Type", ""):
                    payload = json.load(response)
                    if payload.get("openapi"):
                        return
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
            last_error = exc
        time.sleep(1)
    raise RuntimeError(f"Shared service did not become ready at {OPENAPI_URL}: {last_error}")


def _electron_pids() -> set[int]:
    command = (
        "Get-Process electron -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Path -like '*Memory Anki*' } | "
        "Select-Object -ExpandProperty Id"
    )
    completed = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command", command],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return {int(line.strip()) for line in completed.stdout.splitlines() if line.strip().isdigit()}


def _desktop_failed_after(started_at: float) -> str | None:
    if not STATUS_PATH.exists() or STATUS_PATH.stat().st_mtime < started_at:
        return None
    try:
        payload = json.loads(STATUS_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None
    if payload.get("state") == "failed":
        return f"Desktop launcher failed with exit code {payload.get('exit_code')}"
    return None


def _terminate_process_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    subprocess.run(
        ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
        cwd=REPO_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()


def _run_pwa_smoke() -> None:
    print("[launcher-smoke] Running start-pwa.bat --smoke-test", flush=True)
    completed = subprocess.run(
        ["cmd.exe", "/d", "/c", "start-pwa.bat", "--smoke-test"],
        cwd=REPO_ROOT,
        timeout=300,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"start-pwa.bat failed with exit code {completed.returncode}")
    _wait_for_openapi()
    print("[launcher-smoke] PWA launcher ready", flush=True)


def _run_desktop_smoke() -> None:
    before = _electron_pids()
    started_at = time.time()
    print("[launcher-smoke] Running start-desktop.bat", flush=True)
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    process = subprocess.Popen(
        ["cmd.exe", "/d", "/c", "start-desktop.bat"],
        cwd=REPO_ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    try:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            failure = _desktop_failed_after(started_at)
            if failure:
                raise RuntimeError(failure)
            try:
                _wait_for_openapi(timeout_seconds=5)
            except RuntimeError:
                time.sleep(1)
                continue
            if _electron_pids() - before:
                print("[launcher-smoke] Desktop Electron window and shared service ready", flush=True)
                return
            if process.poll() not in (None, 0):
                raise RuntimeError(f"start-desktop.bat exited with code {process.returncode}")
            time.sleep(1)
        raise RuntimeError("Desktop Electron process did not appear within 180 seconds")
    finally:
        _terminate_process_tree(process)


def main() -> int:
    if os.name != "nt":
        print("[launcher-smoke] Skipped: Windows launchers are only available on Windows.")
        return 0
    try:
        _run_pwa_smoke()
        _run_desktop_smoke()
        _run_pwa_smoke()
    except (RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"[launcher-smoke] FAILED: {exc}", file=sys.stderr)
        return 1
    print("[launcher-smoke] All launcher smoke checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())