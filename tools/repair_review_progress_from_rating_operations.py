"""Repair review projections from durable rating operations.

This is an operator-facing recovery tool for a single SQLite app home. It never
creates rating operations; it only reapplies the latest effective operation per
unit and abandons one explicitly supplied unrated session.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now_sql() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(sep=" ")


def _resolve_app_home(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser()
    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root / "apps" / "api" / "src"))
    from memory_anki.core.local_config import load_local_runtime_config

    return load_local_runtime_config(write_device_id=False).local_app_home


def _load_json(value: str, *, field: str, operation_id: str) -> dict[str, Any]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"operation {operation_id} has invalid {field}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"operation {operation_id} has non-object {field}")
    return payload


def _latest_effective_operations(
    connection: sqlite3.Connection,
    *,
    since: str,
    until: str | None,
) -> list[sqlite3.Row]:
    upper_bound = "AND created_at < ?" if until else ""
    params: tuple[str, ...] = (since, until) if until else (since,)
    return connection.execute(
        f"""
        SELECT operation.*
        FROM review_unit_rating_operations AS operation
        JOIN (
            SELECT unit_id, MAX(created_at) AS latest_created_at
            FROM review_unit_rating_operations
            WHERE undone_at IS NULL
              AND replaced_at IS NULL
              AND created_at >= ?
              {upper_bound}
            GROUP BY unit_id
        ) AS latest
          ON latest.unit_id = operation.unit_id
         AND latest.latest_created_at = operation.created_at
        WHERE operation.undone_at IS NULL
          AND operation.replaced_at IS NULL
          AND operation.created_at >= ?
          {upper_bound}
        ORDER BY operation.unit_id, operation.created_at, operation.id
        """,
        params + params,
    ).fetchall()


def repair(
    *,
    database_path: Path,
    session_id: str,
    encounter_id: str,
    since: str,
    until: str | None,
    report_path: Path,
) -> dict[str, Any]:
    if not database_path.exists():
        raise FileNotFoundError(database_path)

    connection = sqlite3.connect(str(database_path))
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    before_integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if before_integrity != "ok":
        raise RuntimeError(f"database integrity check failed before repair: {before_integrity}")

    operations = _latest_effective_operations(connection, since=since, until=until)
    repairs: list[dict[str, Any]] = []
    now = _now_sql()

    try:
        connection.execute("BEGIN IMMEDIATE")

        for operation in operations:
            after = _load_json(
                operation["after_state_json"],
                field="after_state_json",
                operation_id=operation["id"],
            )
            unit = after.get("unit")
            if not isinstance(unit, dict):
                raise RuntimeError(f"operation {operation['id']} has no unit payload")
            required = ("stage_index", "has_passed", "due_date")
            if any(key not in unit for key in required):
                raise RuntimeError(
                    f"operation {operation['id']} unit payload is missing one of {required}"
                )

            current = connection.execute(
                """
                SELECT stage_index, has_passed, due_date, last_passed_at
                FROM review_unit_states
                WHERE id = ?
                """,
                (operation["unit_id"],),
            ).fetchone()
            if current is None:
                raise RuntimeError(f"review unit state not found: {operation['unit_id']}")

            next_last_passed_at = current["last_passed_at"]
            if bool(operation["passed"]):
                next_last_passed_at = operation["created_at"] or now

            connection.execute(
                """
                UPDATE review_unit_states
                SET stage_index = ?,
                    has_passed = ?,
                    due_date = ?,
                    last_passed_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    int(unit["stage_index"]),
                    int(bool(unit["has_passed"])),
                    str(unit["due_date"]),
                    next_last_passed_at,
                    now,
                    operation["unit_id"],
                ),
            )
            repairs.append(
                {
                    "unit_id": operation["unit_id"],
                    "palace_id": operation["palace_id"],
                    "operation_id": operation["id"],
                    "created_at": operation["created_at"],
                    "rating": operation["rating"],
                    "before": dict(current),
                    "after": {
                        "stage_index": int(unit["stage_index"]),
                        "has_passed": bool(unit["has_passed"]),
                        "due_date": str(unit["due_date"]),
                        "last_passed_at": next_last_passed_at,
                    },
                }
            )

        encounter = connection.execute(
            """
            SELECT e.id, e.study_session_id, e.unit_id, e.status, e.selected_rating,
                   s.status AS session_status
            FROM review_unit_encounters AS e
            JOIN study_sessions AS s ON s.id = e.study_session_id
            WHERE e.id = ? AND e.study_session_id = ?
            """,
            (encounter_id, session_id),
        ).fetchone()
        if encounter is None:
            raise RuntimeError("target encounter was not found")
        if encounter["status"] != "open" or encounter["selected_rating"] is not None:
            raise RuntimeError("target encounter is not an unrated open encounter")

        connection.execute("DELETE FROM review_unit_encounters WHERE id = ?", (encounter_id,))
        summary_row = connection.execute(
            "SELECT summary_json FROM study_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        summary: dict[str, Any] = {}
        if summary_row and summary_row["summary_json"]:
            summary = json.loads(summary_row["summary_json"])
            if not isinstance(summary, dict):
                summary = {}
        summary.update({"abandoned_reason": "recovery_unrated_leave", "abandoned_at": now})
        connection.execute(
            """
            UPDATE study_sessions
            SET status = 'abandoned',
                ended_at = ?,
                completion_method = 'recovery_unrated_leave',
                summary_json = ?,
                updated_at = ?
            WHERE id = ? AND status = 'active'
            """,
            (now, json.dumps(summary, ensure_ascii=False), now, session_id),
        )

        connection.commit()
    except Exception:
        connection.rollback()
        connection.close()
        raise

    after_integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if after_integrity != "ok":
        connection.close()
        raise RuntimeError(f"database integrity check failed after repair: {after_integrity}")
    remaining_target = connection.execute(
        "SELECT COUNT(*) FROM review_unit_encounters WHERE id = ?", (encounter_id,)
    ).fetchone()[0]
    target_session = connection.execute(
        "SELECT status FROM study_sessions WHERE id = ?", (session_id,)
    ).fetchone()[0]
    connection.close()

    report = {
        "database": str(database_path),
        "repaired_at": now,
        "since": since,
        "until": until,
        "integrity": after_integrity,
        "effective_operation_count": len(operations),
        "repaired_unit_count": len(repairs),
        "repaired_units": repairs,
        "removed_encounter_id": encounter_id,
        "removed_encounter_count": remaining_target == 0,
        "abandoned_session_id": session_id,
        "abandoned_session_status": target_session,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-home")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--encounter-id", required=True)
    parser.add_argument("--since", required=True)
    parser.add_argument("--until")
    parser.add_argument("--report", required=True)
    args = parser.parse_args()

    app_home = _resolve_app_home(args.app_home)
    database_path = app_home / "data" / "memory_palace.db"
    report = repair(
        database_path=database_path,
        session_id=args.session_id,
        encounter_id=args.encounter_id,
        since=args.since,
        until=args.until,
        report_path=Path(args.report),
    )
    print(json.dumps({
        "database": report["database"],
        "effective_operation_count": report["effective_operation_count"],
        "repaired_unit_count": report["repaired_unit_count"],
        "removed_encounter_id": report["removed_encounter_id"],
        "abandoned_session_id": report["abandoned_session_id"],
        "integrity": report["integrity"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
