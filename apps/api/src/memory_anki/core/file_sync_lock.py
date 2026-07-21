"""Cross-device sync lock for Baidu-synced ``sync_root``.

Locks live under the shared sync tree. A crash can leave a directory lock behind;
this module steals dead same-device PIDs and short-lived foreign stale locks so
``start-desktop.bat`` / ``start-pwa.bat`` are not blocked for 15 minutes.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any

from memory_anki.core.local_config import LocalRuntimeConfig
from memory_anki.core.time import iso_utc_now

LOCK_STALE_SECONDS = 15 * 60
# Locks live under Baidu-synced sync_root; foreign-device locks can linger after
# the other PC finishes. Steal sooner so desktop start is not blocked for 15m.
FOREIGN_LOCK_STALE_SECONDS = 90
LOCK_ACQUIRE_RETRIES = 4
LOCK_ACQUIRE_RETRY_SECONDS = 1.5

logger = logging.getLogger(__name__)


class SyncError(RuntimeError):
    """Raised when file sync or lock acquisition fails."""


def _iso_now() -> str:
    return iso_utc_now(timespec="seconds")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _pid_is_alive(pid: int) -> bool:
    """Best-effort process liveness check for local lock ownership."""
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            process_query_limited_information = 0x1000
            handle = kernel32.OpenProcess(process_query_limited_information, False, int(pid))
            if handle:
                kernel32.CloseHandle(handle)
                return True
            return False
        except Exception:  # pragma: no cover - defensive
            return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _read_lock_meta(lock_dir: Path) -> dict[str, Any]:
    return _read_json(lock_dir / "lock.json")


class SyncLock:
    def __init__(self, lock_dir: Path, config: LocalRuntimeConfig):
        self.lock_dir = lock_dir
        self.config = config
        self.acquired = False

    def _try_steal_existing(self) -> bool:
        """Return True when an existing lock was removed as dead/stale."""
        if not self.lock_dir.exists():
            return False
        try:
            age = time.time() - self.lock_dir.stat().st_mtime
        except OSError:
            age = LOCK_STALE_SECONDS + 1
        meta = _read_lock_meta(self.lock_dir)
        owner_device = str(meta.get("device_id") or "").strip()
        owner_pid = meta.get("pid")
        try:
            owner_pid_int = int(owner_pid) if owner_pid is not None else 0
        except (TypeError, ValueError):
            owner_pid_int = 0

        same_device = bool(owner_device) and owner_device == self.config.device_id
        if same_device and owner_pid_int and not _pid_is_alive(owner_pid_int):
            logger.warning(
                "removing dead local sync lock (pid=%s age=%.0fs): %s",
                owner_pid_int,
                age,
                self.lock_dir,
            )
            shutil.rmtree(self.lock_dir, ignore_errors=True)
            return not self.lock_dir.exists()

        stale_limit = FOREIGN_LOCK_STALE_SECONDS if not same_device else LOCK_STALE_SECONDS
        if age > stale_limit:
            logger.warning(
                "removing stale sync lock (device=%s age=%.0fs limit=%.0fs): %s",
                owner_device or "unknown",
                age,
                stale_limit,
                self.lock_dir,
            )
            shutil.rmtree(self.lock_dir, ignore_errors=True)
            return not self.lock_dir.exists()
        return False

    def __enter__(self) -> SyncLock:
        self.lock_dir.parent.mkdir(parents=True, exist_ok=True)
        last_error: SyncError | None = None
        for attempt in range(LOCK_ACQUIRE_RETRIES):
            try:
                self.lock_dir.mkdir()
                break
            except FileExistsError:
                if self._try_steal_existing():
                    try:
                        self.lock_dir.mkdir()
                        break
                    except FileExistsError:
                        pass
                meta = _read_lock_meta(self.lock_dir) if self.lock_dir.exists() else {}
                owner = str(meta.get("device_name") or meta.get("device_id") or "unknown")
                last_error = SyncError(
                    f"同步锁仍在使用中（持有方: {owner}），请稍后再试: {self.lock_dir}"
                )
                if attempt + 1 < LOCK_ACQUIRE_RETRIES:
                    time.sleep(LOCK_ACQUIRE_RETRY_SECONDS)
                    continue
                raise last_error from None
        else:
            if last_error is not None:
                raise last_error
            raise SyncError(f"无法获取同步锁: {self.lock_dir}")

        _write_json(
            self.lock_dir / "lock.json",
            {
                "device_id": self.config.device_id,
                "device_name": self.config.device_name,
                "created_at": _iso_now(),
                "pid": os.getpid(),
            },
        )
        self.acquired = True
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        if self.acquired:
            shutil.rmtree(self.lock_dir, ignore_errors=True)


__all__ = [
    "FOREIGN_LOCK_STALE_SECONDS",
    "LOCK_ACQUIRE_RETRIES",
    "LOCK_ACQUIRE_RETRY_SECONDS",
    "LOCK_STALE_SECONDS",
    "SyncError",
    "SyncLock",
]
