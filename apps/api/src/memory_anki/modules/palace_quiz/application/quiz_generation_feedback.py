"""Short-answer feedback generation facade."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_feedback_request import (
    prepare_short_answer_feedback_request,
)


def _ai_service():
    from . import ai_service

    return ai_service


def generate_short_answer_feedback(
    session: Session,
    *,
    question_id: int,
    user_answer: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_short_answer_feedback_request(
        session,
        question_id=question_id,
        user_answer=user_answer,
        ai_options=ai_options,
    )
    response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_short_answer_feedback",
        palace_id=prepared_request.question.palace_id,
        messages=prepared_request.messages,
        response_format=None,
        request_payload=prepared_request.request_payload,
    )
    return {
        "question_id": prepared_request.question.id,
        "feedback_text": response_text.strip(),
        "ai_call_log_id": log_id,
        "resolved_ai": prepared_request.resolved_ai,
    }


__all__ = ["generate_short_answer_feedback"]
