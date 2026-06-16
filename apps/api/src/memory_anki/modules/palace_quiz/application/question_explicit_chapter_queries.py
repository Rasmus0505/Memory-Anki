from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter, Palace
from memory_anki.modules.palaces.application.title_sync_service import (
    get_palace_explicit_chapter_ids,
)


def resolve_minimal_explicit_chapter_ids(session: Session, palace: Palace) -> list[int]:
    explicit_ids = get_palace_explicit_chapter_ids(session, palace)
    if not explicit_ids:
        return []
    chapters = session.query(Chapter).filter(Chapter.id.in_(explicit_ids)).all()
    minimal_ids: list[int] = []
    for chapter in chapters:
        has_explicit_descendant = False
        for other in chapters:
            if other.id == chapter.id:
                continue
            current = other.parent
            while current is not None:
                if current.id == chapter.id:
                    has_explicit_descendant = True
                    break
                current = current.parent
            if has_explicit_descendant:
                break
        if not has_explicit_descendant:
            minimal_ids.append(chapter.id)
    return sorted(set(minimal_ids))


__all__ = ["resolve_minimal_explicit_chapter_ids"]
