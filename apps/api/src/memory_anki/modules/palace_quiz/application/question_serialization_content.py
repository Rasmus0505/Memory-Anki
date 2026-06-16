from __future__ import annotations

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_contracts import json_load


def serialize_question_content(question: PalaceQuizQuestion) -> dict[str, object]:
    return {
        "id": question.id,
        "palace_id": question.palace_id,
        "mini_palace_id": question.mini_palace_id,
        "source_chapter_id": question.source_chapter_id,
        "classified_chapter_id": question.classified_chapter_id,
        "origin_question_id": question.origin_question_id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": json_load(question.options_json, []),
        "answer_payload": json_load(question.answer_payload_json, {}),
        "analysis": question.analysis,
        "source_meta": json_load(question.source_meta_json, {}),
        "sort_order": question.sort_order,
        "correct_count": question.correct_count,
        "incorrect_count": question.incorrect_count,
        "attempt_count": question.attempt_count,
        "created_at": question.created_at.isoformat() if question.created_at else None,
        "updated_at": question.updated_at.isoformat() if question.updated_at else None,
    }


__all__ = ["serialize_question_content"]
