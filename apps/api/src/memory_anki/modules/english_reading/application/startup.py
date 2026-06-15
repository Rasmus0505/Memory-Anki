from __future__ import annotations

from sqlalchemy.orm import Session

from .service import prepare_english_reading_runtime


def prepare_english_reading(session: Session) -> dict[str, object]:
    return prepare_english_reading_runtime(session)
