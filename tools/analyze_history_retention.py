"""Read-only analysis of what a history cleanup would actually save.

Answers, before anything is deleted, three questions the owner asked:
  1. What is the 197 MB database actually made of?
  2. How much would retire if sessions older than N months were archived?
  3. What is genuinely risky to touch versus safely inert?

Opens SQLite with ``mode=ro``; writes nothing.
"""
from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

DEFAULT_DB = Path(r"F:\memory anki data\学习数据\memory_palace.db")


def connect(db: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=5.0)


def section(title: str) -> None:
    print()
    print(title)
    print("-" * len(title))


def audit(db: Path, months: int) -> int:
    if not db.exists():
        print(f"database not found: {db}")
        return 1
    con = connect(db)
    try:
        section("A. What the 197 MB is made of (top 15 tables by payload)")
        rows = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        sizes: list[tuple[int, str, int]] = []
        for (name,) in rows:
            try:
                count = con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            except sqlite3.Error:
                continue
            if count:
                sizes.append((count, name, count))
        # Rank by row count; SQLite has no cheap per-table byte accounting.
        sizes.sort(reverse=True)
        print(f"{'rows':>10}  table")
        for count, name, _ in sizes[:15]:
            print(f"{count:>10}  {name}")

        section("B. Sessions older than the cutoff (archive candidate)")
        cutoff = datetime.now() - timedelta(days=30 * months)
        print(f"cutoff: started_at < {cutoff.isoformat(sep=' ', timespec='seconds')}")
        total = con.execute("SELECT COUNT(*) FROM study_sessions").fetchone()[0]
        old = con.execute(
            "SELECT COUNT(*) FROM study_sessions WHERE started_at < ?", (cutoff.isoformat(" "),)
        ).fetchone()[0]
        print(f"  all sessions        : {total}")
        print(f"  older than cutoff   : {old}")
        print(f"  would remain        : {total - old}")

        section("C. Child rows attached to those old sessions")
        for label, sql in (
            (
                "encounters",
                "SELECT COUNT(*) FROM review_unit_encounters WHERE study_session_id IN "
                "(SELECT id FROM study_sessions WHERE started_at < ?)",
            ),
            (
                "learning-time rows",
                "SELECT COUNT(*) FROM session_time_records WHERE study_session_id IN "
                "(SELECT id FROM study_sessions WHERE started_at < ?)",
            ),
        ):
            try:
                print(f"  {label:<20} {con.execute(sql, (cutoff.isoformat(' '),)).fetchone()[0]}")
            except sqlite3.Error as exc:
                print(f"  {label:<20} (unavailable: {exc})")

        section("D. What must NEVER be deleted (the actual study record)")
        for label, sql in (
            ("palaces", "SELECT COUNT(*) FROM palaces WHERE deleted_at IS NULL"),
            ("review unit states (schedule)", "SELECT COUNT(*) FROM review_unit_states"),
            ("review unit operations (rating ledger)", "SELECT COUNT(*) FROM review_unit_operations"),
            ("review unit schedule batches", "SELECT COUNT(*) FROM review_unit_schedule_batches"),
            ("quiz questions", "SELECT COUNT(*) FROM palace_quiz_questions"),
        ):
            try:
                print(f"  {label:<42} {con.execute(sql).fetchone()[0]}")
            except sqlite3.Error as exc:
                print(f"  {label:<42} (unavailable: {exc})")

        section("E. Risk verdict per cleanup class")
        print("  SAFE   orphan open encounters whose session is not active:")
        n = con.execute(
            "SELECT COUNT(*) FROM review_unit_encounters e "
            "LEFT JOIN study_sessions s ON s.id = e.study_session_id "
            "WHERE e.status='open' AND (s.id IS NULL OR s.status <> 'active')"
        ).fetchone()[0]
        print(f"           {n} rows -> closing them cannot lose a rating")
        print("  SAFE   stale 'active' sessions older than 24h:")
        n = con.execute(
            "SELECT COUNT(*) FROM study_sessions WHERE status='active' "
            "AND started_at < datetime('now','-1 day')"
        ).fetchone()[0]
        print(f"           {n} rows -> these never end themselves")
        print("  RISKY  review_unit_states / operations / schedule batches:")
        print("           -> hold review progress. Never touch in a cleanup.")
        print("  RISKY  palaces.editor_doc:")
        print("           -> holds the mindmap content itself. Never touch.")
    finally:
        con.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--months", type=int, default=3, help="archive cutoff in months")
    args = parser.parse_args()
    return audit(args.db, args.months)


if __name__ == "__main__":
    raise SystemExit(main())
