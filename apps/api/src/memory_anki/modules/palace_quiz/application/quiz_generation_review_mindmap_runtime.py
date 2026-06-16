"""Review-mindmap quiz generation runtime orchestration."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_review_mindmap_preview import (
    build_review_mindmap_preview_result,
)
from .quiz_generation_review_mindmap_request import (
    prepare_review_mindmap_generation_request,
)


def _ai_service():
    from . import ai_service

    return ai_service


def generate_quiz_preview_from_review_mindmap(
    session: Session,
    *,
    palace_id: int,
    mode: str,
    question_types: list[str],
    question_count: int,
    review_editor_doc: Any,
    related_palace_ids: list[int] | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    prepared_request = prepare_review_mindmap_generation_request(
        session,
        palace_id=palace_id,
        mode=mode,
        question_types=question_types,
        question_count=question_count,
        review_editor_doc=review_editor_doc,
        related_palace_ids=related_palace_ids,
        ai_options=ai_options,
    )
    response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="宫殿做题",
        operation="palace_quiz_generate_review_mindmap",
        palace_id=palace_id,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    return build_review_mindmap_preview_result(
        prepared_request=prepared_request,
        palace_id=palace_id,
        response_text=response_text,
        log_id=log_id,
    )


__all__ = ["generate_quiz_preview_from_review_mindmap"]
