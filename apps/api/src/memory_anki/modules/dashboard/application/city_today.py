"""Today's island for the learning city: one house per palace rated this study day."""

from __future__ import annotations

from sqlalchemy.orm import Session, joinedload, selectinload

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.memory.public.queries import (
    count_active_units_by_palace,
    list_live_unit_ratings,
)

from .bounds import today_bounds


def build_city_today_payload(session: Session) -> dict:
    start, end = today_bounds()
    latest: dict[int, dict[str, int]] = {}
    rating_counts: dict[int, int] = {}
    for palace_id, unit_id, rating, _created_at in list_live_unit_ratings(session, start=start, end=end):
        # dict keeps first-rated order; a later rating of the same unit only updates its value
        latest.setdefault(palace_id, {})[unit_id] = rating
        rating_counts[palace_id] = rating_counts.get(palace_id, 0) + 1

    palace_ids = list(latest)
    palaces = {
        palace.id: palace
        for palace in session.query(Palace)
        .options(
            joinedload(Palace.primary_chapter).joinedload(Chapter.subject),
            selectinload(Palace.subjects),
        )
        .filter(Palace.id.in_(palace_ids), Palace.deleted_at.is_(None))
        .all()
    } if palace_ids else {}
    totals = count_active_units_by_palace(session, palace_ids)

    items = []
    for palace_id in palace_ids:
        palace = palaces.get(palace_id)
        if palace is None:
            continue
        subject = palace.primary_chapter.subject if palace.primary_chapter else None
        if subject is None and palace.subjects:
            subject = palace.subjects[0]
        items.append(
            {
                "id": palace_id,
                "title": palace.title,
                "subject": {"id": subject.id, "name": subject.name, "color": subject.color} if subject else None,
                "unit_count": totals.get(palace_id, 0),
                "rating_count": rating_counts[palace_id],
                "units": [{"id": uid, "rating": r} for uid, r in latest[palace_id].items()],
            }
        )
    return {"day": local_day().isoformat(), "palaces": items}
