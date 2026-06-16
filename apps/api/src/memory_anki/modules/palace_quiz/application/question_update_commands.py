from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .question_queries import get_question_or_raise
from .question_schema import (
    find_duplicate_question,
    json_load,
    normalize_question_payload,
)
from .question_write_support import (
    commit_updated_question,
    replace_question_with_duplicate,
)


def _build_update_payload(
    question,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "mini_palace_id": payload.get("mini_palace_id", question.mini_palace_id),
        "source_chapter_id": payload.get("source_chapter_id", question.source_chapter_id),
        "classified_chapter_id": payload.get("classified_chapter_id", question.classified_chapter_id),
        "origin_question_id": payload.get("origin_question_id", question.origin_question_id),
        "question_type": payload.get("question_type", question.question_type),
        "stem": payload.get("stem", question.stem),
        "options": payload.get("options", json_load(question.options_json, [])),
        "answer_payload": payload.get("answer_payload", json_load(question.answer_payload_json, {})),
        "analysis": payload.get("analysis", question.analysis),
        "source_meta": payload.get("source_meta", json_load(question.source_meta_json, {})),
    }


def update_question(
    session: Session,
    question_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    question = get_question_or_raise(session, question_id)
    normalized = normalize_question_payload(
        _build_update_payload(question, payload),
        session=session,
        palace_id=question.palace_id,
        source_chapter_id=question.source_chapter_id,
    )
    duplicate = find_duplicate_question(
        session,
        question.palace_id,
        question.source_chapter_id,
        normalized,
        exclude_question_id=question.id,
    )
    if duplicate is not None:
        return replace_question_with_duplicate(
            session,
            kept_row=duplicate,
            removed_row=question,
        )
    return commit_updated_question(
        session,
        row=question,
        normalized=normalized,
    )


__all__ = ["update_question"]
