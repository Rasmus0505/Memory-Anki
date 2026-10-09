"""Live contention capture -- names the real write-lock holder.

Run this WHILE the app is being used and it stalls. It samples, once a second:

  * whether the SQLite write lock is currently held, by trying to take it from a
    second connection (a failure means somebody else holds it, and how long that
    failure took bounds how long they have held it);
  * a py-spy stack sample of the API process, to catch the frame that is inside a
    long NON-SQL step while its transaction is open.

Why this exists separately from the in-app watchdog
---------------------------------------------------
The in-app watchdog (``infrastructure/db/_tables/_base.py``) proved unreliable for
attribution in its first version: it timed transactions from ``after_begin``, so it
reported read-only transactions as writes, and it reported *blocked victims* as the
holder -- because a victim's transaction also stays open for the whole
``busy_timeout`` wait. Three rounds of fixes went after the frames it named, which
were the ones *waiting*, not the ones holding.

The watchdog has since been corrected, but an out-of-process observation is still
worth having: it is independent of that instrumentation and of the app's logging,
and it sees the lock from the OS side.

Usage:  python tools/watch_lock_holder.py [seconds]

Read-only against the app database: it takes the write lock only to test whether it
is free, and immediately rolls back. It never writes data.
"""
from __future__ import annotations

import sqlite3
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
API_PID_HINT = "memory_anki.app.main:app"


def find_api_pid() -> int | None:
    """Locate the uvicorn process serving the app.

    Uses the shared WMI-free enumeration: `Get-CimInstance` blocks forever on a
    machine with a damaged WMI repository, which would silently disable the
    py-spy half of this diagnostic exactly when it is needed most.
    """
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import dev_server

        # The uvicorn target lives in the command line, not the image path, so
        # only python processes need the (still WMI-free) command line lookup.
        for pid, image_path in dev_server.process_command_lines().items():
            if "python" not in image_path.lower():
                continue
            if API_PID_HINT in dev_server.process_command_line(pid):
                return pid
    except Exception as exc:  # noqa: BLE001 - diagnostic helper
        print(f"  (pid lookup failed: {exc})")
    return None


def try_acquire_write_lock(timeout_s: float) -> tuple[bool, float]:
    """Try to take the write lock. Returns (got_it, seconds_spent)."""
    started = time.perf_counter()
    conn = sqlite3.connect(str(DB), timeout=timeout_s, isolation_level=None)
    try:
        conn.execute(f"PRAGMA busy_timeout={int(timeout_s * 1000)}")
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("ROLLBACK")
            return True, time.perf_counter() - started
        except sqlite3.OperationalError:
            return False, time.perf_counter() - started
    finally:
        conn.close()


def sample_stacks(pid: int, samples: int = 2) -> str:
    """A short py-spy stack sample; returns only frames inside this project."""
    try:
        out = subprocess.run(
            ["py-spy", "dump", "--pid", str(pid)],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
    except Exception as exc:  # noqa: BLE001
        return f"(py-spy failed: {exc})"

    interesting: list[str] = []
    for line in out.splitlines():
        text = line.strip()
        if "memory_anki" not in text:
            continue
        if "infrastructure\\db" in text or "infrastructure/db" in text:
            continue
        if "site-packages" in text:
            continue
        interesting.append(text)
    return "\n      ".join(interesting[-12:]) if interesting else "(no application frame)"


def main() -> None:
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 90
    pid = find_api_pid()
    print(f"database : {DB}")
    print(f"api pid  : {pid}")
    print(f"watching : {duration}s  (use the app normally now)\n")

    blocked_events = 0
    worst = 0.0
    deadline = time.monotonic() + duration

    while time.monotonic() < deadline:
        stamp = datetime.now().strftime("%H:%M:%S")
        got_it, spent = try_acquire_write_lock(1.5)
        if got_it:
            print(f"[{stamp}] lock free (acquired in {spent * 1000:.0f} ms)")
        else:
            blocked_events += 1
            worst = max(worst, spent)
            print(f"[{stamp}] *** WRITE LOCK BUSY for {spent:.2f}s — someone is holding it")
            if pid:
                stacks = sample_stacks(pid)
                print(f"      api frames: {stacks}")
        time.sleep(1.0)

    print(f"\nsummary: {blocked_events} blocked samples, worst acquisition {worst:.2f}s")
    if blocked_events == 0:
        print("No contention observed. The failure is load-triggered — re-run while")
        print("actually studying and rating cards.")


if __name__ == "__main__":
    main()
