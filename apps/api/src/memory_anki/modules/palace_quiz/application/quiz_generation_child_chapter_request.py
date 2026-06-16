"""Request preparation for child-chapter question grouping."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions
from .quiz_generation_child_chapter_request_payload import (
    build_child_chapter_grouping_messages,
    build_child_chapter_grouping_model_input,
)


@dataclass(frozen=True, slots=True)
class ChildChapterGroupingPreparedRequest:
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


def prepare_child_chapter_grouping_request(
    session: Session,
    *,
    drafts: list[dict[str, object]],
    child_contexts: list[dict[str, object]],
    ai_options: AiRuntimeOptions | None = None,
) -> ChildChapterGroupingPreparedRequest:
    model_input = build_child_chapter_grouping_model_input(
        drafts=drafts,
        child_contexts=child_contexts,
    )
    system_prompt, messages = build_child_chapter_grouping_messages(
        session=session,
        model_input=model_input,
    )
    config, extra_payload, resolved_ai = _ai_service()._build_chat_config(
        session,
        scenario_key="quiz_mini_palace_grouping",
        ai_options=ai_options,
        temperature=0.2,
        timeout_seconds=90,
    )
    return ChildChapterGroupingPreparedRequest(
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
    "ChildChapterGroupingPreparedRequest",
    "prepare_child_chapter_grouping_request",
]
