from __future__ import annotations

from collections import OrderedDict

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import ReviewSchedule

from .palace_serializer import review_plan_item_json
from .palace_service import get_palace, restore_archived_palaces


def build_palace_review_plan(session: Session, palace_id: int) -> dict | None:
    restore_archived_palaces(session)
    palace = get_palace(session, palace_id)
    if palace is None:
        return None
    schedules = (
        session.query(ReviewSchedule)
        .filter_by(palace_id=palace_id)
        .order_by(ReviewSchedule.scheduled_date, ReviewSchedule.id)
        .all()
    )
    grouped: OrderedDict[str | None, list[ReviewSchedule]] = OrderedDict()
    for schedule in schedules:
        key = schedule.scheduled_date.isoformat() if schedule.scheduled_date else None
        grouped.setdefault(key, []).append(schedule)
    return {
        "palace_id": palace.id,
        "palace_title": palace.title,
        "plan": [
            review_plan_item_json(date_key, grouped_schedules)
            for date_key, grouped_schedules in grouped.items()
        ],
    }
