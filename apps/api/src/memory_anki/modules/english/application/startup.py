from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import engine

from .task_service import cleanup_incomplete_generation_tasks


def ensure_english_storage_schema() -> None:
    with engine.begin() as connection:
        existing_columns = {
            str(row[1])
            for row in connection.exec_driver_sql("PRAGMA table_info(time_records)").fetchall()
        }
        if "source_kind" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE time_records ADD COLUMN source_kind VARCHAR(32)")
        if "english_course_id" not in existing_columns:
            connection.exec_driver_sql("ALTER TABLE time_records ADD COLUMN english_course_id INTEGER")
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_time_records_source_kind_started "
            "ON time_records (source_kind, started_at)"
        )
        connection.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_time_records_english_course_started "
            "ON time_records (english_course_id, started_at)"
        )


def prepare_english_runtime(session: Session) -> dict[str, int]:
    return cleanup_incomplete_generation_tasks(session)
