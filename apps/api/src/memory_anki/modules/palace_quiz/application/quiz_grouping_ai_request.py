"""Request preparation for mini-palace quiz grouping."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
)
from memory_anki.modules.settings.application.ai_prompts import render_prompt

from .quiz_grouping_context import (
    build_mini_palace_context,
    question_payload_for_grouping,
)
from .service import PalaceQuizValidationError


@dataclass(frozen=True, slots=True)
class MiniPalaceGroupingPreparedRequest:
    mini_palace_contexts: list[dict[str, Any]]
    system_prompt: str
    model_input: dict[str, Any]
    messages: list[dict[str, Any]]
    request_payload: dict[str, Any]
    config: Any
    extra_payload: dict[str, Any] | None
    resolved_ai: dict[str, Any]


def _ai_service():
    from . import ai_service

    return ai_service


def prepare_mini_palace_grouping_request(
    session: Session,
    *,
    palace: Any,
    questions: list[dict[str, Any]],
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> MiniPalaceGroupingPreparedRequest:
    mini_palace_contexts = build_mini_palace_context(palace)
    if len(mini_palace_contexts) == 0:
        raise PalaceQuizValidationError("当前宫殿还没有小宫殿，暂时无法按小宫殿分类。")
    if len(questions) == 0:
        raise PalaceQuizValidationError("没有可分类的题目。")

    system_prompt = render_prompt(
        operation,
        {},
        session=session,
    )
    model_input = {
        "mini_palaces": mini_palace_contexts,
        "questions": [
            question_payload_for_grouping(question, index)
            for index, question in enumerate(questions)
        ],
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(model_input, ensure_ascii=False)},
    ]
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_mini_palace_grouping",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=90,
    )
    return MiniPalaceGroupingPreparedRequest(
        mini_palace_contexts=mini_palace_contexts,
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
    "MiniPalaceGroupingPreparedRequest",
    "prepare_mini_palace_grouping_request",
]
