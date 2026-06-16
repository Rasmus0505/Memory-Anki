"""AI execution runtime for child-chapter question grouping."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from ._question_utils import (
    extract_mini_palace_grouping_payload as _extract_mini_palace_grouping_payload,
)
from .quiz_generation_child_chapter_preview import (
    build_group_questions_by_child_chapter_preview,
)
from .quiz_generation_child_chapter_request import (
    prepare_child_chapter_grouping_request,
)


def _ai_service():
    from . import ai_service

    return ai_service


def group_questions_by_child_chapters(
    session: Session,
    *,
    drafts: list[dict[str, object]],
    child_contexts: list[dict[str, object]],
    feature: str,
    operation: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, object]:
    prepared_request = prepare_child_chapter_grouping_request(
        session,
        drafts=drafts,
        child_contexts=child_contexts,
        ai_options=ai_options,
    )
    grouping_response_text, _ = _ai_service()._call_logged_chat_completion(
        config=prepared_request.config,
        extra_payload=prepared_request.extra_payload,
        feature=feature,
        operation=operation,
        palace_id=None,
        messages=prepared_request.messages,
        response_format={"type": "json_object"},
        request_payload=prepared_request.request_payload,
    )
    grouping_payload = _extract_mini_palace_grouping_payload(grouping_response_text)
    return build_group_questions_by_child_chapter_preview(
        drafts=drafts,
        child_contexts=child_contexts,
        grouping_payload=grouping_payload,
    )


__all__ = ["group_questions_by_child_chapters"]
