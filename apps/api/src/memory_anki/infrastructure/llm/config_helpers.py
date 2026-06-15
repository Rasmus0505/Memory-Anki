"""Shared helpers for reading AI-related runtime config rows.

Several modules previously each defined their own private ``_has_non_empty_config``
copy. They were byte-for-byte identical, so the single source of truth lives here.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Config


def has_non_empty_config(session: Session, key: str) -> bool:
    """Return ``True`` when a non-blank ``config`` row exists for ``key``."""
    row = session.query(Config).filter_by(key=key).first()
    return bool(row and str(row.value or "").strip())
