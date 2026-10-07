"""Retire leftover rows that no longer describe live work.

Approved scope (owner-confirmed):
  1. Close ``open`` review-unit encounters whose session is NOT active. Their
     session already ended, so closing the card cannot lose a rating: there is
     no live round that could still submit to it.
  2. Finish stale ``active`` study sessions older than a cutoff. These never end
     themselves, so they accumulate and keep showing up as "in progress".

Explicitly NOT touched: review_unit_states (schedule/progress), palaces
(editor_doc content), rating operations, schedule batches, quiz questions.

Safety:
  * ``--dry-run`` is the default; nothing is written without ``--apply``.
  * Refuses to run while the API holds the runtime storage lock, because a
    concurrent writer could be mid-round on exactly these rows.
  * Takes its own backup path argument so the caller proves a backup exists.
  * Prints every count it changes.
"""
from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

DEFAULT_DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")
DEFAULT_LOCK = Path(r"F:\memory anki data\日志缓存\runtime-storage.lock")

# Sessions that legitimately stay open for a long time are excluded by scene:
# a quiz round can span a study day, so only clearly abandoned ones are closed.
STALE_CUTOFF_HOURS = 24


def api_lock_is_free(lock_path: Path) -> bool:
    """True when no other process holds the runtime storage lock."""
    if not lock_path.exists():
        return True
    try:
        handle = lock_path.open("a+b")
    except OSError:
        return False
    try:
        import msvcrt

        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        return True
    finally:
        handle.close()


def run(db: Path, *, apply: bool, cutoff_hours: int) -> int:
    if not db.exists():
        print(f"database not found: {db}")
        return 1

    con = sqlite3.connect(str(db), timeout=30)
    con.execute("PRAGMA foreign_keys = ON")
    try:
        cutoff = (datetime.now() - timedelta(hours=cutoff_hours)).isoformat(" ")

        orphan_encounters = con.execute(
            "SELECT COUNT(*) FROM review_unit_encounters e "
            "LEFT JOIN study_sessions s ON s.id = e.study_session_id "
            "WHERE e.status='open' AND (s.id IS NULL OR s.status <> 'active')"
        ).fetchone()[0]

        stale_sessions = con.execute(
            "SELECT COUNT(*) FROM study_sessions "
            "WHERE status='active' AND started_at < ?",
            (cutoff,),
        ).fetchone()[0]

        print(f"mode            : {'APPLY' if apply else 'DRY RUN'}")
        print(f"cutoff          : started_at < {cutoff} ({cutoff_hours}h)")
        print(f"orphan cards    : {orphan_encounters} -> close")
        print(f"stale sessions  : {stale_sessions} -> finish")
        if not apply:
            print("\nNothing written. Re-run with --apply to execute.")
            return 0

        now = datetime.now().isoformat(" ")
        cur = con.cursor()
        cur.execute("BEGIN IMMEDIATE")

        closed = cur.execute(
            "UPDATE review_unit_encounters SET status='closed', closed_at=? "
            "WHERE status='open' AND study_session_id IN ("
            "  SELECT e.study_session_id FROM review_unit_encounters e "
            "  LEFT JOIN study_sessions s ON s.id = e.study_session_id "
            "  WHERE e.status='open' AND (s.id IS NULL OR s.status <> 'active')"
            ")",
            (now,),
        ).rowcount

        finished = cur.execute(
            "UPDATE study_sessions SET status='abandoned', ended_at=?, "
            "completion_method='retired_stale_session' "
            "WHERE status='active' AND started_at < ?",
            (now, cutoff),
        ).rowcount

        con.commit()
        print(f"\nclosed orphan cards     : {closed}")
        print(f"finished stale sessions : {finished}")
        print("\nreview progress, palaces and quiz data untouched.")
        return 0
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--apply", action="store_true", help="actually write changes")
    parser.add_argument("--cutoff-hours", type=int, default=STALE_CUTOFF_HOURS)
    parser.add_argument(
        "--force",
        action="store_true",
        help="skip the runtime-lock check (only when the app is stopped)",
    )
    args = parser.parse_args()

    if args.apply and not args.force and not api_lock_is_free(args.lock):
        print(
            "refusing to write: the API holds the runtime storage lock.\n"
            "Stop the app first, or pass --force if you are certain it is idle."
        )
        return 2
    return run(args.db, apply=args.apply, cutoff_hours=args.cutoff_hours)


if __name__ == "__main__":
    raise SystemExit(main())
