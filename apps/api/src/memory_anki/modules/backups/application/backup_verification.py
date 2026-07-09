from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from memory_anki.core.config import APP_HOME, DB_PATH, FULL_BACKUPS_DIR
from memory_anki.modules.backups.application.backup_lifecycle import list_backups
from memory_anki.modules.backups.application.storage_backup import read_storage_backup_manifest

KEY_TABLES = [
    "palaces",
    "pegs",
    "palace_segments",
    "palace_quiz_questions",
    "review_schedules",
    "review_logs",
    "study_sessions",
    "subjects",
    "chapters",
    "config",
]

REPORTS_DIR = APP_HOME / "backup-verify-reports"


def find_latest_backup_with_database() -> Path | None:
    """Return the newest full backup directory that contains a database snapshot."""
    if not FULL_BACKUPS_DIR.exists():
        return None

    candidates: list[Path] = []
    known_paths = {Path(item["path"]) for item in list_backups() if item.get("kind") == "full"}
    if known_paths:
        search_paths = [path for path in known_paths if path.exists() and path.is_dir()]
    else:
        search_paths = [child for child in FULL_BACKUPS_DIR.iterdir() if child.is_dir()]

    for folder in search_paths:
        if resolve_backup_database_path(folder).exists():
            candidates.append(folder)
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.stat().st_mtime)


def verify_backup(backup_dir: Path | None = None) -> tuple[dict[str, Any], Path | None]:
    """Copy a backup database to a temp location and run read-only restore checks."""
    selected_backup = backup_dir or find_latest_backup_with_database()
    if selected_backup is None or not selected_backup.is_dir():
        return _failure_report(selected_backup, "未找到含数据库的备份目录。"), None

    backup_db = resolve_backup_database_path(selected_backup)
    if not backup_db.exists():
        return _failure_report(selected_backup, f"备份中缺少数据库文件：{backup_db}"), None

    temp_dir = Path(tempfile.mkdtemp(prefix="memory-anki-verify-"))
    report: dict[str, Any] = {
        "backup_dir": str(selected_backup),
        "backup_database": str(backup_db),
        "verified_at": datetime.now().isoformat(timespec="seconds"),
        "ok": True,
        "problems": [],
    }
    try:
        restored_db = temp_dir / DB_PATH.name
        shutil.copy2(backup_db, restored_db)

        integrity = integrity_check(restored_db)
        report["integrity_check"] = integrity
        if integrity != "ok":
            report["ok"] = False
            report["problems"].append(f"integrity_check 失败：{integrity}")

        backup_version = read_alembic_version(restored_db)
        live_version = read_alembic_version(DB_PATH) if DB_PATH.exists() else None
        report["alembic_version"] = {"backup": backup_version, "live": live_version}
        if backup_version is None:
            report["ok"] = False
            report["problems"].append("备份库缺少 alembic_version 表。")
        elif live_version and backup_version != live_version:
            report["problems"].append(
                f"备份迁移版本 {backup_version} 落后于生产 {live_version}（恢复后需 alembic upgrade head）。"
            )

        backup_counts = table_counts(restored_db)
        live_counts = table_counts(DB_PATH) if DB_PATH.exists() else {}
        report["table_counts"] = {"backup": backup_counts, "live": live_counts}
        for table, count in backup_counts.items():
            if count == -1 and live_counts.get(table, -1) != -1:
                report["ok"] = False
                report["problems"].append(f"备份库缺少表 {table}。")
            live = live_counts.get(table)
            if live is not None and live >= 0 and count >= 0 and count < live:
                report["problems"].append(
                    f"表 {table}：备份 {count} 行 < 生产 {live} 行（备份时点差异）。"
                )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    report_path = write_report(report)
    return report, report_path


def resolve_backup_database_path(backup_dir: Path) -> Path:
    manifest = read_storage_backup_manifest(backup_dir)
    for item in manifest.get("included_items") or []:
        if not isinstance(item, dict) or item.get("key") != "database":
            continue
        relative_path = str(item.get("relative_path") or "").strip()
        if relative_path:
            return backup_dir / relative_path

    candidates = []
    try:
        candidates.append(backup_dir / DB_PATH.relative_to(APP_HOME))
    except ValueError:
        pass
    candidates.extend(
        [
            backup_dir / "data" / DB_PATH.name,
            backup_dir / DB_PATH.name,
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0] if candidates else backup_dir / DB_PATH.name


def read_alembic_version(db_file: Path) -> str | None:
    try:
        with sqlite3.connect(_readonly_sqlite_uri(db_file), uri=True) as conn:
            row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
            return str(row[0]) if row else None
    except sqlite3.Error:
        return None


def integrity_check(db_file: Path) -> str:
    try:
        with sqlite3.connect(_readonly_sqlite_uri(db_file), uri=True) as conn:
            row = conn.execute("PRAGMA integrity_check").fetchone()
            return str(row[0]) if row else "no result"
    except sqlite3.Error as exc:
        return str(exc)


def table_counts(db_file: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    try:
        with sqlite3.connect(_readonly_sqlite_uri(db_file), uri=True) as conn:
            for table in KEY_TABLES:
                try:
                    row = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()
                    counts[table] = int(row[0])
                except sqlite3.Error:
                    counts[table] = -1
    except sqlite3.Error:
        counts = dict.fromkeys(KEY_TABLES, -1)
    return counts


def _readonly_sqlite_uri(db_file: Path) -> str:
    return f"{db_file.resolve().as_uri()}?mode=ro"


def write_report(report: dict[str, Any]) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / f"verify-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


def _failure_report(backup_dir: Path | None, message: str) -> dict[str, Any]:
    return {
        "backup_dir": str(backup_dir) if backup_dir is not None else None,
        "verified_at": datetime.now().isoformat(timespec="seconds"),
        "ok": False,
        "problems": [message],
    }
