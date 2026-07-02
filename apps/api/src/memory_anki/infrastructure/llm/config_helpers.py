from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Config


def has_non_empty_config(session: Session, key: str) -> bool:
    row = session.query(Config).filter_by(key=key).first()
    return bool(row and str(row.value or "").strip())


def has_non_empty_configs(session: Session, keys: set[str]) -> dict[str, bool]:
    if not keys:
        return {}
    rows = session.query(Config.key, Config.value).filter(Config.key.in_(tuple(keys))).all()
    values = {key: bool(str(value or "").strip()) for key, value in rows}
    return {key: values.get(key, False) for key in keys}
