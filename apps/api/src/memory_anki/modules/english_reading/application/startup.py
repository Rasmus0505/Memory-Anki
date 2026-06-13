from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    EnglishReadingDictionaryCache,
    engine,
)

from .service import ensure_english_reading_storage, prepare_english_reading_runtime


def ensure_english_reading_storage_schema() -> dict[str, object]:
    with engine.begin() as connection:
        table_info = connection.exec_driver_sql(
            "PRAGMA table_info(english_reading_dictionary_cache)"
        ).fetchall()
        existing_columns = {str(row[1]) for row in table_info}
        needs_reset = bool(table_info) and "provider" in existing_columns
        if needs_reset:
            connection.exec_driver_sql("DROP TABLE IF EXISTS english_reading_dictionary_cache")
            table_info = []
        if not table_info:
            EnglishReadingDictionaryCache.__table__.create(bind=connection, checkfirst=True)
    return ensure_english_reading_storage()


def prepare_english_reading(session: Session) -> dict[str, object]:
    return prepare_english_reading_runtime(session)
