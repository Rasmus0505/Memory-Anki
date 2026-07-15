"""Application services for knowledge chapters."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    chapter_palace_table,
)
from memory_anki.modules.backups.api import maybe_create_rolling_backup
from memory_anki.modules.knowledge.domain.schemas import ChapterCreate
from memory_anki.platform.application import UnitOfWork


def chapter_json(c: Chapter) -> dict:
    children = c.children or []
    return {
        "id": c.id,
        "subject_id": c.subject_id,
        "parent_id": c.parent_id,
        "name": c.name,
        "sort_order": c.sort_order,
        "notes": c.notes,
        "children": [chapter_json(ch) for ch in children],
        "palace_count": len(c.palaces or []),
    }


def _subject_json(s) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "color": s.color,
        "sort_order": s.sort_order,
    }


def _palace_out(p: Palace) -> dict:
    schedules = list(p.review_schedules or [])
    completed = sum(1 for item in schedules if item.completed)
    pending_dates = sorted(
        item.scheduled_date for item in schedules if not item.completed
    )
    return {
        "id": p.id,
        "title": p.title,
        "pegs": [{"id": pg.id, "name": pg.name, "content": pg.content} for pg in p.pegs],
        "mastered": bool(p.mastered),
        "archived": bool(p.archived),
        "review_stage_completed": completed,
        "review_stage_total": len(schedules),
        "next_due_date": pending_dates[0].isoformat() if pending_dates else None,
    }


def get_chapter_detail(session: Session, chapter_id: int) -> dict | None:
    c = (
        session.query(Chapter)
        .options(
            selectinload(Chapter.subject),
            selectinload(Chapter.children).selectinload(Chapter.children),
            selectinload(Chapter.children).selectinload(Chapter.palaces),
            selectinload(Chapter.palaces).selectinload(Palace.pegs),
            selectinload(Chapter.palaces).selectinload(Palace.review_schedules),
        )
        .filter_by(id=chapter_id)
        .first()
    )
    if not c:
        return None

    chapters_by_id = {
        row.id: row
        for row in session.query(Chapter.id, Chapter.parent_id, Chapter.name)
        .filter(Chapter.subject_id == c.subject_id)
        .all()
    }
    breadcrumbs: list[dict[str, int | str]] = []
    cur_id = c.parent_id
    seen: set[int] = set()
    while cur_id and cur_id in chapters_by_id and cur_id not in seen:
        seen.add(cur_id)
        parent = chapters_by_id[cur_id]
        breadcrumbs.insert(0, {"id": parent.id, "name": parent.name})
        cur_id = parent.parent_id

    return {
        "chapter": {
            "id": c.id,
            "name": c.name,
            "notes": c.notes,
            "subject": _subject_json(c.subject) if c.subject else None,
            "children": [chapter_json(ch) for ch in (c.children or [])],
            "breadcrumbs": breadcrumbs,
        },
        "palaces": [_palace_out(p) for p in c.palaces],
    }


def create_chapter(
    session: Session,
    subject_id: int,
    data: ChapterCreate,
    *,
    uow: UnitOfWork,
    before_commit: Callable[[dict], None] | None = None,
) -> dict:
    c = Chapter(
        subject_id=subject_id,
        parent_id=data.parent_id,
        name=data.name,
        notes=data.notes,
        sort_order=data.sort_order,
    )
    session.add(c)
    session.flush()
    session.refresh(c)
    result = chapter_json(c)
    if before_commit is not None:
        before_commit(result)
    uow.commit()
    maybe_create_rolling_backup("rolling-create-chapter")
    return result


def update_chapter(
    session: Session,
    chapter_id: int,
    data: dict,
    *,
    uow: UnitOfWork,
) -> dict | None:
    c = session.query(Chapter).filter_by(id=chapter_id).first()
    if not c:
        return None
    for key in ("name", "notes", "sort_order", "parent_id"):
        if key in data:
            setattr(c, key, data[key])
    uow.commit()
    uow.refresh(c)
    maybe_create_rolling_backup("rolling-update-chapter")
    return chapter_json(c)


def _delete_recursive(chapter: Chapter, session: Session) -> None:
    for child in chapter.children:
        _delete_recursive(child, session)
    session.delete(chapter)


def _collect_subtree_ids(chapter: Chapter) -> list[int]:
    ids = [chapter.id]
    for child in chapter.children or []:
        ids.extend(_collect_subtree_ids(child))
    return ids


def get_chapter_delete_impact(session: Session, chapter: Chapter) -> dict[str, int]:
    subtree_ids = _collect_subtree_ids(chapter)
    linked_palace_count = (
        session.query(func.count(func.distinct(chapter_palace_table.c.palace_id)))
        .filter(chapter_palace_table.c.chapter_id.in_(subtree_ids))
        .scalar()
        or 0
    )
    question_count = (
        session.query(PalaceQuizQuestion)
        .filter(PalaceQuizQuestion.source_chapter_id.in_(subtree_ids))
        .count()
    )
    return {
        "chapter_count": len(subtree_ids),
        "linked_palace_count": int(linked_palace_count),
        "question_count": int(question_count),
    }


def delete_chapter(
    session: Session,
    chapter_id: int,
    *,
    force: bool = False,
    uow: UnitOfWork,
) -> dict[str, Any]:
    c = session.query(Chapter).filter_by(id=chapter_id).first()
    if not c:
        return {"ok": True}

    impact = get_chapter_delete_impact(session, c)
    if not force and (
        impact["linked_palace_count"] > 0 or impact["question_count"] > 0
    ):
        return {
            "ok": False,
            "requires_force": True,
            **impact,
        }

    subtree_ids = _collect_subtree_ids(c)
    session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.source_chapter_id.in_(subtree_ids)
    ).delete(synchronize_session=False)
    _delete_recursive(c, session)
    uow.commit()
    maybe_create_rolling_backup("rolling-delete-chapter")
    return {"ok": True}
