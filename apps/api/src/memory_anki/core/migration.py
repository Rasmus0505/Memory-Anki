from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from memory_anki.core.config import (
    APP_HOME,
    ATTACHMENTS_DIR,
    DB_PATH,
    FULL_BACKUPS_DIR,
    LEGACY_DATA_DIR,
    MIGRATION_STATE_PATH,
    RESCUE_BACKUPS_DIR,
    ensure_runtime_dirs,
)
from memory_anki.core.time import iso_utc_now


def _write_state(payload: dict) -> None:
    APP_HOME.mkdir(parents=True, exist_ok=True)
    MIGRATION_STATE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _read_state() -> dict | None:
    if not MIGRATION_STATE_PATH.exists():
        return None
    try:
        return json.loads(MIGRATION_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def is_app_migration_completed(key: str) -> bool:
    state = _read_state() or {}
    app_migrations = state.get("app_migrations") or {}
    entry = app_migrations.get(key) or {}
    return bool(entry.get("completed"))


def mark_app_migration_completed(key: str, payload: dict | None = None) -> None:
    state = _read_state() or {}
    app_migrations = state.setdefault("app_migrations", {})
    entry = {
        "completed": True,
        "completed_at": iso_utc_now(),
    }
    if payload:
        entry.update(payload)
    app_migrations[key] = entry
    _write_state(state)


def _table_count(path: Path) -> int:
    if not path.exists():
        return 0
    connection = sqlite3.connect(path)
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        row = cursor.fetchone()
        return int(row[0]) if row else 0
    except Exception:
        return 0
    finally:
        connection.close()


def _should_replace_runtime_db(legacy_db: Path) -> bool:
    if not legacy_db.exists():
        return False
    if not DB_PATH.exists():
        return True
    legacy_size = legacy_db.stat().st_size
    runtime_size = DB_PATH.stat().st_size
    if runtime_size == 0:
        return True
    runtime_tables = _table_count(DB_PATH)
    legacy_tables = _table_count(legacy_db)
    if runtime_tables <= 2 and legacy_tables > runtime_tables:
        return True
    return legacy_size > runtime_size and legacy_tables >= runtime_tables


def ensure_legacy_repo_data_migrated() -> None:
    ensure_runtime_dirs()
    state = _read_state()
    if state and state.get("completed"):
        return

    legacy_db = LEGACY_DATA_DIR / "memory_palace.db"
    legacy_attachments = LEGACY_DATA_DIR / "attachments"
    legacy_backups = LEGACY_DATA_DIR / "backups"
    if not legacy_db.exists() and not legacy_attachments.exists() and not legacy_backups.exists():
        if not state:
            _write_state({"completed": True, "migrated_at": iso_utc_now(), "source": None})
        return

    rescue_root = RESCUE_BACKUPS_DIR / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-before-legacy-migration"
    rescue_root.mkdir(parents=True, exist_ok=True)

    if DB_PATH.exists():
        shutil.copy2(DB_PATH, rescue_root / DB_PATH.name)
    if ATTACHMENTS_DIR.exists():
        shutil.copytree(ATTACHMENTS_DIR, rescue_root / "attachments", dirs_exist_ok=True)
    if FULL_BACKUPS_DIR.exists():
        shutil.copytree(FULL_BACKUPS_DIR, rescue_root / "full", dirs_exist_ok=True)
    if RESCUE_BACKUPS_DIR.exists():
        (rescue_root / "rescue-note.txt").write_text(
            "Existing rescue backups were retained in place before legacy migration.",
            encoding="utf-8",
        )

    if _should_replace_runtime_db(legacy_db):
        shutil.copy2(legacy_db, DB_PATH)
    if legacy_attachments.exists():
        shutil.copytree(legacy_attachments, ATTACHMENTS_DIR, dirs_exist_ok=True)
    if legacy_backups.exists():
        shutil.copytree(legacy_backups / "full", FULL_BACKUPS_DIR, dirs_exist_ok=True)
        shutil.copytree(legacy_backups / "rescue", RESCUE_BACKUPS_DIR, dirs_exist_ok=True)

    _write_state(
        {
            "completed": True,
            "migrated_at": iso_utc_now(),
            "source": str(LEGACY_DATA_DIR),
            "rescue_snapshot": str(rescue_root),
        }
    )
