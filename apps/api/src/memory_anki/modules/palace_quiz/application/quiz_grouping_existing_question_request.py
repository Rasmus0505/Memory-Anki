"""Request preparation for classifying existing palace quiz questions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
)

from .question_schema import serialize_question_rows
from .service import (
    PalaceQuizValidationError,
    get_palace_or_raise,
    list_root_question_rows,
)


@dataclass(frozen=True, slots=True)
class ExistingQuestionGroupingRequest:
    palace: Any
    source_questions: list[Any]
    source_payloads: list[dict[str, object]]
    ai_options: AiRuntimeOptions | None


def prepare_existing_question_grouping_request(
    session: Session,
    *,
    palace_id: int,
    ai_options: AiRuntimeOptions | None,
) -> ExistingQuestionGroupingRequest:
    palace = get_palace_or_raise(session, palace_id)
    source_questions = list_root_question_rows(session, palace_id=palace_id)
    if len(source_questions) == 0:
        raise PalaceQuizValidationError("当前大宫殿题库还没有可归类的题目。")
    return ExistingQuestionGroupingRequest(
        palace=palace,
        source_questions=source_questions,
        source_payloads=serialize_question_rows(source_questions),
        ai_options=ai_options,
    )


__all__ = [
    "ExistingQuestionGroupingRequest",
    "prepare_existing_question_grouping_request",
]
