"""Read-only audit of historical leftover rows that slow the review path.

Writes nothing: opens SQLite with ``mode=ro`` so the live API's WAL is untouched.
Emits a human-reviewable inventory grouped by what the row is and how old it is,
so the owner can decide what to retire before any cleanup runs.

Usage:
    python tools/audit_leftover_sessions.py
    python tools/audit_leftover_sessions.py --db "F:\\memory anki data\\学习数据\\memory_palace.db"
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")

# Scenes whose long-lived "active" rows are leftovers rather than live work.
LEFT_OVER_SCENES = (
    "freestyle_unit_review",
    "review",
    "quiz",
    "practice",
    "palace_edit",
)


def connect(db: Path) -> sqlite3.Connection:
    uri = f"file:{db.as_posix()}?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=5.0)


def section(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def audit(db: Path) -> int:
    if not db.exists():
        print(f"database not found: {db}")
        return 1
    con = connect(db)
    try:
        section("1. Active sessions by scene (oldest first)")
        print(f"{'scene':<24}{'status':<12}{'count':>7}  {'oldest':<21}{'newest':<21}")
        for scene, status, count, oldest, newest in con.execute(
            "SELECT COALESCE(scene,'(null)'), status, COUNT(*), MIN(started_at), MAX(started_at) "
            "FROM study_sessions GROUP BY 1, 2 ORDER BY 3 DESC"
        ):
            print(f"{scene:<24}{status:<12}{count:>7}  {str(oldest):<21}{str(newest):<21}")

        section("2. Leftover 'active' sessions that are not today's work")
        placeholders = ",".join("?" * len(LEFT_OVER_SCENES))
        rows = con.execute(
            f"SELECT scene, COUNT(*), MIN(started_at), MAX(started_at) FROM study_sessions "
            f"WHERE status='active' AND scene IN ({placeholders}) GROUP BY scene",
            LEFT_OVER_SCENES,
        ).fetchall()
        total = 0
        for scene, count, oldest, newest in rows:
            total += count
            print(f"  {scene:<24} {count:>6} rows   {oldest}  ->  {newest}")
        print(f"  {'TOTAL':<24} {total:>6} rows")

        section("3. Open encounters never closed")
        for status, count in con.execute(
            "SELECT status, COUNT(*) FROM review_unit_encounters GROUP BY status"
        ):
            print(f"  {status:<12} {count}")
        open_orphans = con.execute(
            "SELECT COUNT(*) FROM review_unit_encounters e "
            "LEFT JOIN study_sessions s ON s.id = e.study_session_id "
            "WHERE e.status='open' AND (s.id IS NULL OR s.status <> 'active')"
        ).fetchone()[0]
        print(f"  open encounters whose session is NOT active (orphans): {open_orphans}")

        section("4. Sessions invalidated by topology change (reconcile feedback signature)")
        n = con.execute(
            "SELECT COUNT(*) FROM study_sessions WHERE completion_method='unit_topology_changed'"
        ).fetchone()[0]
        print(f"  invalidated by unit_topology_changed: {n}")

        section("5. Freestyle round states")
        for status, count in con.execute(
            "SELECT status, COUNT(*) FROM freestyle_round_states GROUP BY status"
        ):
            print(f"  {status:<12} {count}")
        multi = con.execute(
            "SELECT workspace, COUNT(*) FROM freestyle_round_states "
            "WHERE status='active' GROUP BY workspace"
        ).fetchall()
        for workspace, count in multi:
            flag = "  <-- more than one active round in this workspace" if count > 1 else ""
            print(f"  active in workspace {workspace!r}: {count}{flag}")

        section("6. Review unit projection size")
        for label, sql in (
            ("active unit states", "SELECT COUNT(*) FROM review_unit_states WHERE active=1"),
            ("inactive unit states", "SELECT COUNT(*) FROM review_unit_states WHERE active=0"),
            (
                "palaces with active units",
                "SELECT COUNT(DISTINCT palace_id) FROM review_unit_states WHERE active=1",
            ),
        ):
            print(f"  {label:<26} {con.execute(sql).fetchone()[0]}")

        section("7. Biggest editor documents (reconcile cost driver)")
        for palace_id, title, length in con.execute(
            "SELECT id, COALESCE(title,''), LENGTH(COALESCE(editor_doc,'')) FROM palaces "
            "WHERE deleted_at IS NULL AND archived=0 ORDER BY 3 DESC LIMIT 10"
        ):
            print(f"  palace {palace_id:>5}  {length:>9,} bytes  {str(title)[:40]}")

        section("8. Database file size")
        for suffix in ("", "-wal", "-shm"):
            path = Path(str(db) + suffix)
            if path.exists():
                print(f"  {path.name:<28} {path.stat().st_size / 1024 / 1024:>8.2f} MB")
    finally:
        con.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    return audit(args.db)


if __name__ == "__main__":
    raise SystemExit(main())
