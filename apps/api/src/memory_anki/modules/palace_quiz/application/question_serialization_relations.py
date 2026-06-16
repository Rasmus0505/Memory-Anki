from __future__ import annotations

from typing import Any

from memory_anki.infrastructure.db.models import PalaceQuizQuestion


def _serialize_mini_palace_relation(mini_palace: Any) -> dict[str, object] | None:
    if not mini_palace:
        return None
    return {
        "id": mini_palace.id,
        "name": mini_palace.name,
    }


def _serialize_source_chapter_relation(source_chapter: Any) -> dict[str, object] | None:
    if not source_chapter:
        return None
    return {
        "id": source_chapter.id,
        "name": source_chapter.name,
        "subject_id": source_chapter.subject_id,
    }


def _serialize_classified_chapter_relation(
    classified_chapter: Any,
) -> dict[str, object] | None:
    if not classified_chapter:
        return None
    return {
        "id": classified_chapter.id,
        "name": classified_chapter.name,
        "subject_id": classified_chapter.subject_id,
        "parent_id": classified_chapter.parent_id,
    }


def serialize_question_relations(question: PalaceQuizQuestion) -> dict[str, object]:
    return {
        "mini_palace": _serialize_mini_palace_relation(getattr(question, "mini_palace", None)),
        "source_chapter": _serialize_source_chapter_relation(
            getattr(question, "source_chapter", None)
        ),
        "classified_chapter": _serialize_classified_chapter_relation(
            getattr(question, "classified_chapter", None)
        ),
    }


__all__ = ["serialize_question_relations"]
