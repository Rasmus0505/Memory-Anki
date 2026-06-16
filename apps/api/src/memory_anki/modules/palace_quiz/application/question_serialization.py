from __future__ import annotations

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_serialization_content import serialize_question_content
from .question_serialization_relations import serialize_question_relations


def serialize_question(question: PalaceQuizQuestion) -> dict[str, object]:
    return {
        **serialize_question_content(question),
        **serialize_question_relations(question),
    }


def serialize_question_rows(rows: list[PalaceQuizQuestion]) -> list[dict[str, object]]:
    return [serialize_question(row) for row in rows]


__all__ = [
    "serialize_question",
    "serialize_question_rows",
]
