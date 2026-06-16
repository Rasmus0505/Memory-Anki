"""Payload assembly for short-answer feedback generation requests."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_prompts import render_prompt

from .quiz_generation_feedback_request_context import (
    ShortAnswerFeedbackRequestContext,
)


def build_short_answer_feedback_model_input(
    context: ShortAnswerFeedbackRequestContext,
) -> dict[str, Any]:
    return {
        "stem": context.question.stem,
        "user_answer": context.normalized_user_answer,
        "reference_answer": context.reference_answer,
        "analysis": context.question.analysis,
    }


def build_short_answer_feedback_messages(
    *,
    session: Session,
    model_input: dict[str, Any],
) -> tuple[str, list[dict[str, object]]]:
    system_prompt = render_prompt(
        "ai_prompt_palace_quiz_short_answer_feedback",
        {},
        session=session,
    )
    messages: list[dict[str, object]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    return system_prompt, messages


__all__ = [
    "build_short_answer_feedback_messages",
    "build_short_answer_feedback_model_input",
]
