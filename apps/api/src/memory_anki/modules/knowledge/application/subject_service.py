"""Application services for knowledge subjects."""
from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.modules.backups.api import maybe_create_rolling_backup
from memory_anki.modules.knowledge.application.chapter_service import chapter_json
from memory_anki.modules.knowledge.application.editor_state_service import (
    get_subject_editor_state,
    save_subject_editor_state,
    sync_subject_editor_root,
)
from memory_anki.platform.application import UnitOfWork


def subject_json(s: Subject) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "color": s.color,
        "sort_order": s.sort_order,
    }


def list_subjects(
    session: Session,
    *,
    limit: int | None = None,
    offset: int = 0,
) -> list[dict] | dict:
    query = session.query(Subject).order_by(Subject.sort_order)
    if limit is None:
        return [subject_json(sub) for sub in query.all()]
    items = [subject_json(sub) for sub in query.offset(offset).limit(limit).all()]
    return {
        "items": items,
        "total": session.query(Subject).count(),
        "limit": limit,
        "offset": offset,
    }


def create_subject(
    session: Session,
    *,
    name: str,
    color: str,
    sort_order: int,
    uow: UnitOfWork,
    before_commit: Callable[[dict], None] | None = None,
) -> dict:
    sub = Subject(name=name, color=color, sort_order=sort_order)
    session.add(sub)
    session.flush()
    session.refresh(sub)
    response = subject_json(sub)
    if before_commit is not None:
        before_commit(response)
    uow.commit()
    return response


def update_subject(
    session: Session,
    subject_id: int,
    data: dict,
    *,
    uow: UnitOfWork,
) -> dict | None:
    sub = session.query(Subject).filter_by(id=subject_id).first()
    if not sub:
        return None
    for key in ("name", "color", "sort_order"):
        if key in data:
            setattr(sub, key, data[key])
    sync_subject_editor_root(sub)
    uow.commit()
    uow.refresh(sub)
    return subject_json(sub)



def get_subject_delete_impact(session: Session, subject_id: int) -> dict | None:
    subject = session.query(Subject).filter_by(id=subject_id).first()
    if subject is None:
        return None
    palace_count = len({palace.id for palace in (getattr(subject, "palaces", []) or [])})
    chapter_count = len(getattr(subject, "chapters", []) or [])
    return {
        "subject_id": subject.id,
        "subject_name": subject.name,
        "palace_count": palace_count,
        "chapter_count": chapter_count,
        "blocked": palace_count > 0 or chapter_count > 0,
    }

def delete_subject(
    session: Session,
    subject_id: int,
    *,
    uow: UnitOfWork,
) -> bool:
    sub = session.query(Subject).filter_by(id=subject_id).first()
    if not sub:
        return False
    session.delete(sub)
    uow.commit()
    return True


def get_subject_tree(session: Session, subject_id: int) -> dict | None:
    subject = session.query(Subject).filter_by(id=subject_id).first()
    if not subject:
        return None
    root_chapters = [c for c in subject.chapters if c.parent_id is None]
    return {
        "subject": subject_json(subject),
        "chapters": [chapter_json(c) for c in root_chapters],
    }


def get_subject_editor_payload(session: Session, subject_id: int) -> dict | None:
    subject = session.query(Subject).filter_by(id=subject_id).first()
    if not subject:
        return None
    return {
        "subject": subject_json(subject),
        **get_subject_editor_state(subject),
    }


def save_subject_editor(
    session: Session,
    subject_id: int,
    data: dict,
    *,
    uow: UnitOfWork | None = None,
) -> dict | None:
    subject = session.query(Subject).filter_by(id=subject_id).first()
    if not subject:
        return None
    result = {
        "subject": subject_json(subject),
        **save_subject_editor_state(session, subject, data, uow=uow),
    }
    maybe_create_rolling_backup("rolling-subject-editor-save")
    return result
