"""Per-palace memory snapshot for consumers that draw the knowledge map (read-only)."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

from ..domain.retention import mastered_ratio, mean_recall
from .star_context import load_palace_contexts


def build_memory_snapshot(session: Session, *, today: date | None = None) -> dict[str, Any]:
    on = today or date.today()
    contexts = load_palace_contexts(session)
    due: dict[int, int] = {
        int(palace_id): int(count)
        for palace_id, count in session.query(ReviewUnitState.palace_id, func.count(ReviewUnitState.id))
        .filter(ReviewUnitState.active.is_(True))
        .filter(ReviewUnitState.due_date <= on)
        .group_by(ReviewUnitState.palace_id)
    }
    palaces = [
        {
            "id": ctx.palace_id,
            "title": ctx.title,
            "subject_id": ctx.subject_id,
            "chapter_id": ctx.primary_chapter_id,
            "stars": ctx.stars.stars,
            "unit_count": len(ctx.units),
            "learned_count": sum(1 for unit in ctx.units if unit.has_passed),
            "mastery_ratio": round(mastered_ratio(ctx.units, on), 4),
            "recall": round(mean_recall(ctx.units, on), 4),
            "due_count": due.get(ctx.palace_id, 0),
        }
        for ctx in contexts.values()
    ]
    subjects = [
        {"id": int(s.id), "name": s.name, "color": s.color or ""}
        for s in session.query(Subject).order_by(Subject.id)
    ]
    chapters = [
        {
            "id": int(c.id),
            "subject_id": int(c.subject_id),
            "parent_id": int(c.parent_id) if c.parent_id else None,
            "name": c.name,
            "sort_order": c.sort_order or 0,
            "exam_stars": c.exam_stars,
        }
        for c in session.query(Chapter).order_by(Chapter.subject_id, Chapter.sort_order, Chapter.id)
    ]
    return {"subjects": subjects, "chapters": chapters, "palaces": palaces}
