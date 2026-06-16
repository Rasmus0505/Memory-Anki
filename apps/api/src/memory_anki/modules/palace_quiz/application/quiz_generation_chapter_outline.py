"""Chapter-outline quiz generation facade."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_chapter_outline_preview import (
    build_chapter_outline_preview_result,
)
from .quiz_generation_chapter_outline_request import (
    prepare_chapter_outline_generation_request,
)
from .quiz_generation_chapter_outline_support import (
    chapter_outline_payload,
    normalize_outline_question_count,
    normalize_outline_question_types,
)


def _ai_service():
    from . import ai_service

    return ai_service


def generate_quiz_preview_from_chapter_outline(
    session: Session,
    *,
    chapter_id: int,
    question_types: list[str],
    question_count: int,
    extra_prompt: str,
    classify_by_child_chapter: bool = False,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_chapter_outline_generation_request(
        session,
        chapter_id=chapter_id,
        question_types=question_types,
        question_count=question_count,
        extra_prompt=extra_prompt,
        classify_by_child_chapter=classify_by_child_chapter,
        ai_options=ai_options,
    )
    response_text, log_id = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature="章节做题",
        operation="chapter_quiz_generate_outline",
        palace_id=None,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    return build_chapter_outline_preview_result(
        session,
        prepared_request=prepared_request,
        chapter_id=chapter_id,
        response_text=response_text,
        log_id=log_id,
        classify_by_child_chapter=classify_by_child_chapter,
        ai_options=ai_options,
    )


__all__ = [
    "chapter_outline_payload",
    "generate_quiz_preview_from_chapter_outline",
    "normalize_outline_question_count",
    "normalize_outline_question_types",
]
