from __future__ import annotations

from sqlalchemy.orm import Session

from .service import ensure_english_reading_storage, prepare_english_reading_runtime


def ensure_english_reading_storage_schema() -> dict[str, object]:
    return ensure_english_reading_storage()


def prepare_english_reading(session: Session) -> dict[str, object]:
    return prepare_english_reading_runtime(session)
