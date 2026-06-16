"""Streaming logged AI runtime execution for palace quiz flows."""

from __future__ import annotations

from collections.abc import Generator

from memory_anki.infrastructure.llm import (
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    stream_chat_completion_text,
)

from .ai_service_runtime_errors import fail_ai_call_log_and_raise
from .ai_service_runtime_logging import (
    complete_ai_call_log,
    start_ai_call_log,
)
from .ai_service_runtime_request import LoggedChatCompletionRequest


def call_logged_chat_completion_stream(
    request: LoggedChatCompletionRequest,
) -> Generator[str, None, tuple[str, str]]:
    log_id = start_ai_call_log(
        config=request.config,
        feature=request.feature,
        operation=request.operation,
        palace_id=request.palace_id,
        request_payload=request.request_payload,
        image_items=request.image_items,
    )
    response_parts: list[str] = []
    try:
        stream = stream_chat_completion_text(
            config=request.config,
            messages=request.messages,
            response_format=request.response_format,
            extra_payload=request.extra_payload,
        )
        while True:
            try:
                delta = next(stream)
            except StopIteration as exc:
                final_text = str(exc.value or "".join(response_parts))
                complete_ai_call_log(log_id, response_text=final_text)
                return final_text, log_id
            response_parts.append(delta)
            yield delta
    except (
        OpenAICompatibleProtocolError,
        OpenAICompatibleHttpError,
        OpenAICompatibleNetworkError,
    ) as exc:
        fail_ai_call_log_and_raise(log_id=log_id, config=request.config, error=exc)


__all__ = ["call_logged_chat_completion_stream"]
