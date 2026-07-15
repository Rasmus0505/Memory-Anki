from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.platform.application import UnitOfWork

from .palace_chapter_binding import (
    get_palace_explicit_chapter_ids,
    reconcile_palace_chapter_binding,
    set_palace_chapter_links,
)

UNCATEGORIZED_SUBJECT_NAME = "未分类"
UNCATEGORIZED_SUBJECT_COLOR = "#94a3b8"


class KnowledgeBindingConflictError(RuntimeError):
    pass


class KnowledgeBindingValidationError(ValueError):
    pass


def ensure_uncategorized_subject(session: Session) -> Subject:
    subject = (
        session.query(Subject)
        .filter(Subject.name == UNCATEGORIZED_SUBJECT_NAME)
        .order_by(Subject.id)
        .first()
    )
    if subject is None:
        max_sort = session.query(Subject.sort_order).order_by(Subject.sort_order.desc()).first()
        subject = Subject(
            name=UNCATEGORIZED_SUBJECT_NAME,
            color=UNCATEGORIZED_SUBJECT_COLOR,
            sort_order=max((max_sort[0] if max_sort else 0) + 1, 999999),
        )
        session.add(subject)
        session.flush()
    return subject


def resolve_subjects(session: Session, subject_ids: list[int]) -> list[Subject]:
    normalized = sorted({int(value) for value in subject_ids})
    if not normalized:
        return [ensure_uncategorized_subject(session)]
    subjects = session.query(Subject).filter(Subject.id.in_(normalized)).all()
    found = {subject.id for subject in subjects}
    missing = [subject_id for subject_id in normalized if subject_id not in found]
    if missing:
        raise KnowledgeBindingValidationError(f"学科不存在：{missing}")
    return sorted(subjects, key=lambda item: (item.sort_order or 0, item.name or "", item.id))


def assign_palace_subjects(session: Session, palace: Palace, subject_ids: list[int]) -> list[Subject]:
    subjects = resolve_subjects(session, subject_ids)
    palace.subjects = subjects
    session.flush()
    return subjects


def knowledge_binding_json(session: Session, palace: Palace) -> dict:
    explicit_ids = get_palace_explicit_chapter_ids(session, palace)
    chapters = list(getattr(palace, "chapters", []) or [])
    return {
        "palace_id": palace.id,
        "subjects": [
            {
                "id": subject.id,
                "name": subject.name,
                "color": subject.color,
                "sort_order": subject.sort_order,
            }
            for subject in sorted(
                list(getattr(palace, "subjects", []) or []),
                key=lambda item: (item.sort_order or 0, item.name or "", item.id),
            )
        ],
        "explicit_chapter_ids": sorted(explicit_ids),
        "inherited_chapter_ids": sorted(
            chapter.id for chapter in chapters if chapter.id not in explicit_ids
        ),
        "primary_chapter_id": palace.primary_chapter_id,
        "binding_revision": int(getattr(palace, "binding_revision", 0) or 0),
    }


def update_palace_knowledge_binding(
    session: Session,
    palace: Palace,
    *,
    subject_ids: list[int],
    chapter_ids: list[int],
    preferred_primary_chapter_id: int | None,
    base_revision: int,
    uow: UnitOfWork,
) -> dict:
    current_revision = int(getattr(palace, "binding_revision", 0) or 0)
    if base_revision != current_revision:
        raise KnowledgeBindingConflictError(
            f"宫殿归属已更新（当前版本 {current_revision}，请求版本 {base_revision}）"
        )

    subjects = resolve_subjects(session, subject_ids)
    allowed_subject_ids = {subject.id for subject in subjects}
    normalized_chapter_ids = sorted({int(value) for value in chapter_ids})
    chapters = (
        session.query(Chapter).filter(Chapter.id.in_(normalized_chapter_ids)).all()
        if normalized_chapter_ids
        else []
    )
    found_chapter_ids = {chapter.id for chapter in chapters}
    missing_chapter_ids = [value for value in normalized_chapter_ids if value not in found_chapter_ids]
    if missing_chapter_ids:
        raise KnowledgeBindingValidationError(f"章节不存在：{missing_chapter_ids}")
    invalid_chapters = [chapter.id for chapter in chapters if chapter.subject_id not in allowed_subject_ids]
    if invalid_chapters:
        normalized_chapter_ids = [
            chapter_id for chapter_id in normalized_chapter_ids if chapter_id not in set(invalid_chapters)
        ]
        chapters = [chapter for chapter in chapters if chapter.id in set(normalized_chapter_ids)]
        found_chapter_ids = {chapter.id for chapter in chapters}

    palace.subjects = subjects
    _, expanded_ids = set_palace_chapter_links(session, palace, normalized_chapter_ids)
    preferred = (
        preferred_primary_chapter_id
        if preferred_primary_chapter_id in found_chapter_ids
        else None
    )
    reconcile_palace_chapter_binding(
        session, palace, preferred_primary_chapter_id=preferred
    )
    palace.binding_revision = current_revision + 1
    session.flush()
    uow.commit()
    uow.refresh(palace)
    return {**knowledge_binding_json(session, palace), "chapter_count": len(expanded_ids)}
