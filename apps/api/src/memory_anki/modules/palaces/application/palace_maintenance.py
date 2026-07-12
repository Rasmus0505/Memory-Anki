from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.palaces.infrastructure.repositories import PalaceRepository

_RESTORE_ARCHIVED_PALACES_SESSION_KEY = "palaces.restore_archived_palaces.done"


def restore_all_archived_palaces(session: Session) -> int:
    """Explicit legacy maintenance command; never call from query paths."""
    if session.info.get(_RESTORE_ARCHIVED_PALACES_SESSION_KEY):
        return 0
    session.info[_RESTORE_ARCHIVED_PALACES_SESSION_KEY] = True
    repository = PalaceRepository(session)
    restored = repository.restore_archived()
    if restored:
        session.commit()
    return restored
