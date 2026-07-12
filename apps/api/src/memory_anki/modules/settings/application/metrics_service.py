from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy import table as sql_table
from sqlalchemy.orm import Session

from memory_anki.core.config import DB_PATH
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import ExternalAiCallLog
from memory_anki.modules.backups.api import list_backups

# User-facing core tables only. Names come from infrastructure/db/_tables.
METRIC_TABLES = [
    "subjects",
    "chapters",
    "palaces",
    "palace_segments",
    "palace_mini_palaces",
    "palace_quiz_questions",
    "review_schedules",
    "review_logs",
    "study_sessions",
    "external_ai_call_logs",
    "english_courses",
    "english_reading_materials",
]


def _database_size_bytes() -> int | None:
    try:
        return DB_PATH.stat().st_size
    except OSError:
        return None


def _table_row_counts(session: Session) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table_name in METRIC_TABLES:
        try:
            count = session.execute(
                select(func.count()).select_from(sql_table(table_name))
            ).scalar_one()
            counts[table_name] = int(count)
        except Exception:
            counts[table_name] = -1
    return counts


def _ai_calls_last_24h(session: Session) -> dict[str, int]:
    since = utc_now_naive() - timedelta(hours=24)
    base = session.query(ExternalAiCallLog).filter(ExternalAiCallLog.created_at >= since)
    total = base.count()
    failed = base.filter(ExternalAiCallLog.status == "error").count()
    return {"total": total, "failed": failed}


def _latest_backup() -> dict[str, Any] | None:
    backups = list_backups()
    if not backups:
        return None
    latest = max(backups, key=lambda item: str(item.get("created_at") or ""))
    return {
        "created_at": latest.get("created_at"),
        "kind": latest.get("kind"),
        "scope": latest.get("scope"),
        "name": latest.get("name"),
        "has_database": latest.get("has_database"),
    }


def build_metrics(session: Session) -> dict[str, Any]:
    return {
        "generated_at": utc_now_naive().isoformat(timespec="seconds"),
        "database": {
            "path": str(DB_PATH),
            "size_bytes": _database_size_bytes(),
        },
        "table_row_counts": _table_row_counts(session),
        "ai_calls_last_24h": _ai_calls_last_24h(session),
        "latest_backup": _latest_backup(),
    }
