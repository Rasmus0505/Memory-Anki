"""Per-palace star, subject and memory-unit context shared by overview and ordering."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    palace_subject_table,
)
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.public.queries import INTERVAL_DAYS

from ..domain.priority import palace_priority, share_factor
from ..domain.retention import UnitMemory, forgetting_degree
from ..domain.stars import (
    SUBJECTIVE_QUESTION_TYPE,
    ResolvedStars,
    chapter_chain,
    resolve_palace_stars,
)


@dataclass
class PalaceExamContext:
    palace_id: int
    title: str
    subject_id: int | None
    primary_chapter_id: int | None
    own_stars: int | None
    own_source: str | None
    stars: ResolvedStars
    question_count: int = 0
    subjective_count: int = 0
    units: list[UnitMemory] = field(default_factory=list)


def _interval(stage_index: int) -> int:
    return INTERVAL_DAYS[max(0, min(int(stage_index), len(INTERVAL_DAYS) - 1))]


def load_palace_contexts(
    session: Session,
    palace_ids: list[int] | None = None,
    *,
    include_units: bool = True,
) -> dict[int, PalaceExamContext]:
    query = session.query(
        Palace.id,
        Palace.title,
        Palace.manual_title,
        Palace.title_mode,
        Palace.primary_chapter_id,
        Palace.exam_stars,
        Palace.exam_stars_source,
    ).filter(Palace.archived.is_(False))
    if palace_ids is not None:
        if not palace_ids:
            return {}
        query = query.filter(Palace.id.in_(palace_ids))
    palace_rows = query.all()
    if not palace_rows:
        return {}
    ids = [int(row.id) for row in palace_rows]

    chapters = session.query(Chapter.id, Chapter.parent_id, Chapter.subject_id, Chapter.exam_stars).all()
    parents = {int(c.id): (int(c.parent_id) if c.parent_id else None) for c in chapters}
    chapter_stars = {int(c.id): c.exam_stars for c in chapters}
    chapter_subject = {int(c.id): int(c.subject_id) for c in chapters if c.subject_id}

    subject_by_palace: dict[int, int] = {}
    for palace_id, subject_id in (
        session.query(palace_subject_table.c.palace_id, func.min(palace_subject_table.c.subject_id))
        .filter(palace_subject_table.c.palace_id.in_(ids))
        .group_by(palace_subject_table.c.palace_id)
    ):
        subject_by_palace[int(palace_id)] = int(subject_id)

    counts: dict[int, list[int]] = {}
    for palace_id, question_type, total in (
        session.query(PalaceQuizQuestion.palace_id, PalaceQuizQuestion.question_type, func.count())
        .filter(PalaceQuizQuestion.palace_id.in_(ids))
        .filter(PalaceQuizQuestion.lifecycle_status == "published")
        .group_by(PalaceQuizQuestion.palace_id, PalaceQuizQuestion.question_type)
    ):
        bucket = counts.setdefault(int(palace_id), [0, 0])
        bucket[0] += int(total)
        if str(question_type or "") == SUBJECTIVE_QUESTION_TYPE:
            bucket[1] += int(total)

    contexts: dict[int, PalaceExamContext] = {}
    for row in palace_rows:
        palace_id = int(row.id)
        primary = int(row.primary_chapter_id) if row.primary_chapter_id else None
        question_count, subjective_count = counts.get(palace_id, [0, 0])
        title = (row.manual_title if row.title_mode == "manual" and row.manual_title else row.title) or f"宫殿 {palace_id}"
        contexts[palace_id] = PalaceExamContext(
            palace_id=palace_id,
            title=str(title),
            subject_id=subject_by_palace.get(palace_id) or (chapter_subject.get(primary) if primary else None),
            primary_chapter_id=primary,
            own_stars=row.exam_stars,
            own_source=row.exam_stars_source,
            stars=resolve_palace_stars(
                palace_stars=row.exam_stars,
                palace_source=row.exam_stars_source,
                chapter_chain=chapter_chain(primary, parents, chapter_stars),
                question_count=question_count,
                subjective_count=subjective_count,
            ),
            question_count=question_count,
            subjective_count=subjective_count,
        )

    if include_units:
        for unit in (
            session.query(
                ReviewUnitState.palace_id,
                ReviewUnitState.stage_index,
                ReviewUnitState.has_passed,
                ReviewUnitState.last_passed_at,
            )
            .filter(ReviewUnitState.active.is_(True))
            .filter(ReviewUnitState.palace_id.in_(ids))
        ):
            context = contexts.get(int(unit.palace_id))
            if context is not None:
                context.units.append(
                    UnitMemory(
                        palace_id=context.palace_id,
                        stage_interval_days=_interval(unit.stage_index),
                        has_passed=bool(unit.has_passed),
                        last_passed_at=unit.last_passed_at,
                    )
                )
    return contexts


def subject_shares(session: Session) -> tuple[dict[int, int | None], int]:
    rows = session.query(Subject.id, Subject.exam_share).all()
    return {int(r.id): r.exam_share for r in rows}, len(rows)


def palace_priority_scores(
    session: Session,
    palace_ids: list[int] | None = None,
    *,
    today: date | None = None,
) -> dict[int, float]:
    on = today or date.today()
    contexts = load_palace_contexts(session, palace_ids)
    shares, subject_count = subject_shares(session)
    return {
        palace_id: palace_priority(
            ctx.stars.stars,
            forgetting_degree(ctx.units, on),
            share_factor(shares.get(ctx.subject_id) if ctx.subject_id else None, subject_count),
        )
        for palace_id, ctx in contexts.items()
    }


def resolve_stars_for_palaces(session: Session, palace_ids: list[int] | None = None) -> dict[int, int]:
    return {
        palace_id: ctx.stars.stars
        for palace_id, ctx in load_palace_contexts(session, palace_ids, include_units=False).items()
    }
