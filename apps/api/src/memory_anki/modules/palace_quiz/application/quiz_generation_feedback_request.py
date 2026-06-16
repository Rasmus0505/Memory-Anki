"""Request preparation for short-answer feedback generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_feedback_request_context import (
    load_short_answer_feedback_request_context,
)
from .quiz_generation_feedback_request_payload import (
    build_short_answer_feedback_messages,
    build_short_answer_feedback_model_input,
)


@dataclass(frozen=True, slots=True)
class ShortAnswerFeedbackPreparedRequest:
    question: Any
    normalized_user_answer: str
    system_prompt: str
    model_input: dict[str, Any]
    messages: list[dict[str, object]]
    request_payload: dict[str, Any]
    config: Any
    extra_payload: dict[str, Any] | None
    resolved_ai: dict[str, Any]


def _ai_service():
    from . import ai_service

    return ai_service


def prepare_short_answer_feedback_request(
    session: Session,
    *,
    question_id: int,
    user_answer: str,
    ai_options: AiRuntimeOptions | None,
) -> ShortAnswerFeedbackPreparedRequest:
    request_context = load_short_answer_feedback_request_context(
        session,
        question_id=question_id,
        user_answer=user_answer,
    )
    model_input = build_short_answer_feedback_model_input(request_context)
    system_prompt, messages = build_short_answer_feedback_messages(
        session=session,
        model_input=model_input,
    )
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_short_answer_feedback",
        ai_options=ai_options,
        temperature=0.3,
        timeout_seconds=90,
    )
    return ShortAnswerFeedbackPreparedRequest(
        question=request_context.question,
        normalized_user_answer=request_context.normalized_user_answer,
        system_prompt=system_prompt,
        model_input=model_input,
        messages=messages,
        request_payload={
            "prompt": system_prompt,
            "messages": messages,
            "model_input": model_input,
            "resolved_ai": resolved_ai,
        },
        config=config,
        extra_payload=extra_payload,
        resolved_ai=resolved_ai,
    )


__all__ = [
    "ShortAnswerFeedbackPreparedRequest",
    "prepare_short_answer_feedback_request",
]
