from __future__ import annotations

from typing import Any

from memory_anki.infrastructure.db._tables.palaces import PalaceQuizQuestion

from ..question_contracts import json_load


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
        "lifecycle_status": question.lifecycle_status,
        "evidence": json_load(question.evidence_json, []),
        "knowledge_tags": json_load(question.knowledge_tags_json, []),
        "cognitive_level": question.cognitive_level,
        "difficulty": question.difficulty,
        "quality_score": question.quality_score,
        "quality_review": json_load(question.quality_review_json, {}),
        "generation_job_id": question.generation_job_id,
        "version_number": question.version_number,
        "sort_order": question.sort_order,
        "correct_count": question.correct_count,
        "incorrect_count": question.incorrect_count,
        "attempt_count": question.attempt_count,
        "created_at": question.created_at.isoformat() if question.created_at else None,
        "updated_at": question.updated_at.isoformat() if question.updated_at else None,
    }


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


def serialize_question(question: PalaceQuizQuestion) -> dict[str, object]:
    return {
        **serialize_question_content(question),
        **serialize_question_relations(question),
    }


def serialize_question_rows(rows: list[PalaceQuizQuestion]) -> list[dict[str, object]]:
    return [serialize_question(row) for row in rows]


__all__ = [
    "serialize_question",
    "serialize_question_content",
    "serialize_question_relations",
    "serialize_question_rows",
]
