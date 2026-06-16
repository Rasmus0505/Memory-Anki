"""External AI call log helpers for palace quiz flows."""

from __future__ import annotations

from typing import Any

from memory_anki.infrastructure.llm import OpenAICompatibleChatConfig
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
)


def start_ai_call_log(
    *,
    config: OpenAICompatibleChatConfig,
    feature: str,
    operation: str,
    palace_id: int | None,
    request_payload: dict[str, Any],
    image_items: list[tuple[bytes, str | None]] | None,
) -> str:
    return begin_external_ai_call_log(
        feature=feature,
        operation=operation,
        provider="openai_compatible",
        base_url=config.base_url,
        model=config.model,
        palace_id=palace_id,
        request_payload=request_payload,
        image_items=image_items,
    )


def complete_ai_call_log(
    log_id: str,
    *,
    response_text: str,
) -> None:
    complete_external_ai_call_log(
        log_id,
        response_payload={"response_text": response_text},
    )


__all__ = [
    "complete_ai_call_log",
    "start_ai_call_log",
]
