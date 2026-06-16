"""AI-powered mini-palace grouping preview runtime."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
)

from . import ai_service as _ai
from ._question_utils import extract_mini_palace_grouping_payload
from .quiz_grouping_preview import build_grouped_preview_from_indexes
from .quiz_grouping_ai_request import prepare_mini_palace_grouping_request


def group_questions_by_mini_palaces(
    session: Session,
    *,
    palace: Any,
    questions: list[dict[str, Any]],
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    prepared_request = prepare_mini_palace_grouping_request(
        session,
        palace=palace,
        questions=questions,
        operation=operation,
        ai_options=ai_options,
    )
    response_text, log_id = _ai._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation=operation,
        palace_id=palace.id,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    grouping_payload = extract_mini_palace_grouping_payload(response_text)
    grouped_preview = build_grouped_preview_from_indexes(
        questions=questions,
        grouping_payload=grouping_payload,
        mini_palace_contexts=prepared_request.mini_palace_contexts,
    )
    return grouped_preview, log_id, prepared_request.resolved_ai


__all__ = ["group_questions_by_mini_palaces"]
