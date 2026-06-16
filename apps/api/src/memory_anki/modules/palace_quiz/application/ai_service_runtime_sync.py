"""Synchronous logged AI runtime execution for palace quiz flows."""

from __future__ import annotations

from memory_anki.infrastructure.llm import (
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    call_chat_completion_text,
)

from .ai_service_runtime_errors import fail_ai_call_log_and_raise
from .ai_service_runtime_logging import (
    complete_ai_call_log,
    start_ai_call_log,
)
from .ai_service_runtime_request import LoggedChatCompletionRequest


def call_logged_chat_completion(
    request: LoggedChatCompletionRequest,
) -> tuple[str, str]:
    log_id = start_ai_call_log(
        config=request.config,
        feature=request.feature,
        operation=request.operation,
        palace_id=request.palace_id,
        request_payload=request.request_payload,
        image_items=request.image_items,
    )
    try:
        response_text = call_chat_completion_text(
            config=request.config,
            messages=request.messages,
            response_format=request.response_format,
            extra_payload=request.extra_payload,
        )
    except (
        OpenAICompatibleProtocolError,
        OpenAICompatibleHttpError,
        OpenAICompatibleNetworkError,
    ) as exc:
        fail_ai_call_log_and_raise(log_id=log_id, config=request.config, error=exc)
    complete_ai_call_log(log_id, response_text=response_text)
    return response_text, log_id


__all__ = ["call_logged_chat_completion"]
