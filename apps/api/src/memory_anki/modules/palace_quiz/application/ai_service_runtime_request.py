"""Shared request model for palace-quiz logged AI runtime calls."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from memory_anki.infrastructure.llm import OpenAICompatibleChatConfig


@dataclass(frozen=True, slots=True)
class LoggedChatCompletionRequest:
    config: OpenAICompatibleChatConfig
    extra_payload: dict[str, Any] | None
    feature: str
    operation: str
    palace_id: int | None
    messages: list[dict[str, Any]]
    response_format: dict[str, Any] | None
    request_payload: dict[str, Any]
    image_items: list[tuple[bytes, str | None]] | None = None


__all__ = ["LoggedChatCompletionRequest"]
