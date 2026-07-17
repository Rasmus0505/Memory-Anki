from __future__ import annotations

from typing import Any

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceSegment
from memory_anki.modules.palaces.api import (
    resolve_palace_subject,
    resolve_palace_title,
)


def chapter_context(chapter: Chapter | None) -> dict[str, Any] | None:
    if chapter is None:
        return None
    return {
        "id": chapter.id,
        "name": chapter.name,
        "subject_id": chapter.subject_id,
        "parent_id": chapter.parent_id,
        "subject": (
            {
                "id": chapter.subject.id,
                "name": chapter.subject.name,
                "color": getattr(chapter.subject, "color", "#6366f1"),
            }
            if chapter.subject
            else None
        ),
    }


def palace_context(palace: Palace) -> dict[str, Any]:
    primary_chapter = getattr(palace, "primary_chapter", None)
    parent_chapter = (
        primary_chapter.parent
        if primary_chapter is not None and getattr(primary_chapter, "parent", None)
        else None
    )
    subject = resolve_palace_subject(palace)
    return {
        "id": palace.id,
        "title": palace.title,
        "resolved_title": resolve_palace_title(palace),
        "subject": (
            {
                "id": subject.id,
                "name": subject.name,
                "color": getattr(subject, "color", "#6366f1"),
            }
            if subject
            else None
        ),
        "primary_chapter": chapter_context(primary_chapter),
        "parent_chapter": chapter_context(parent_chapter),
    }


def segment_context(segment: PalaceSegment) -> dict[str, Any]:
    return {
        "id": segment.id,
        "palace_id": segment.palace_id,
        "name": segment.name or f"学习组 {segment.sort_order + 1}",
        "sort_order": segment.sort_order,
    }


__all__ = [
    "chapter_context",
    "segment_context",
    "palace_context",
]
