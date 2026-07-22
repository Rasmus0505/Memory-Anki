from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace

from .palace_chapter_binding import (
    reconcile_palace_chapter_binding,
    set_palace_chapter_links,
)


def update_palace_chapter_binding(
    session: Session,
    palace: Palace,
    *,
    chapter_ids: list[int],
    preferred_primary_chapter_id: int | None,
) -> set[int]:
    _, expanded_ids = set_palace_chapter_links(session, palace, chapter_ids)
    reconcile_palace_chapter_binding(
        session,
        palace,
        preferred_primary_chapter_id=preferred_primary_chapter_id,
    )
    return expanded_ids
