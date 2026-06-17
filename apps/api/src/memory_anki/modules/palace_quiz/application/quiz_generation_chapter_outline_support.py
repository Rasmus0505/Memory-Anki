"""Support helpers for chapter-outline quiz generation."""

from __future__ import annotations

from typing import Any

from memory_anki.infrastructure.db.models import Chapter

from .question_contracts import QUESTION_TYPES


def normalize_outline_question_types(raw_question_types: Any) -> list[str]:
    if not isinstance(raw_question_types, list):
        raw_question_types = []
    normalized: list[str] = []
    for item in raw_question_types:
        question_type = str(item or "").strip()
        if question_type in QUESTION_TYPES and question_type not in normalized:
            normalized.append(question_type)
    return normalized or ["multiple_choice", "short_answer"]


def normalize_outline_question_count(raw_question_count: Any) -> int:
    try:
        count = int(raw_question_count or 5)
    except (TypeError, ValueError):
        count = 5
    return max(1, min(count, 30))


def chapter_outline_payload(chapter: Chapter) -> dict[str, Any]:
    return {
        "id": chapter.id,
        "name": chapter.name,
        "notes": str(chapter.notes or "").strip(),
        "children": [chapter_outline_payload(child) for child in (chapter.children or [])],
    }


__all__ = [
    "chapter_outline_payload",
    "normalize_outline_question_count",
    "normalize_outline_question_types",
]
