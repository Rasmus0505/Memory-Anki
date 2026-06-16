"""AI transport, logging, and error mapping for palace quiz flows."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from memory_anki.infrastructure.llm import OpenAICompatibleChatConfig

from .ai_service_runtime_request import LoggedChatCompletionRequest
from .ai_service_runtime_stream import (
    call_logged_chat_completion_stream,
)
from .ai_service_runtime_sync import call_logged_chat_completion


def _call_logged_chat_completion(
    *,
    config: OpenAICompatibleChatConfig,
    extra_payload: dict[str, Any] | None,
    feature: str,
    operation: str,
    palace_id: int | None,
    messages: list[dict[str, Any]],
    response_format: dict[str, Any] | None,
    request_payload: dict[str, Any],
    image_items: list[tuple[bytes, str | None]] | None = None,
) -> tuple[str, str]:
    return call_logged_chat_completion(
        LoggedChatCompletionRequest(
            config=config,
            extra_payload=extra_payload,
            feature=feature,
            operation=operation,
            palace_id=palace_id,
            messages=messages,
            response_format=response_format,
            request_payload=request_payload,
            image_items=image_items,
        )
    )


def _call_logged_chat_completion_stream(
    *,
    config: OpenAICompatibleChatConfig,
    extra_payload: dict[str, Any] | None,
    feature: str,
    operation: str,
    palace_id: int | None,
    messages: list[dict[str, Any]],
    response_format: dict[str, Any] | None,
    request_payload: dict[str, Any],
    image_items: list[tuple[bytes, str | None]] | None = None,
) -> Generator[str, None, tuple[str, str]]:
    return call_logged_chat_completion_stream(
        LoggedChatCompletionRequest(
            config=config,
            extra_payload=extra_payload,
            feature=feature,
            operation=operation,
            palace_id=palace_id,
            messages=messages,
            response_format=response_format,
            request_payload=request_payload,
            image_items=image_items,
        )
    )


__all__ = [
    "_call_logged_chat_completion",
    "_call_logged_chat_completion_stream",
]
