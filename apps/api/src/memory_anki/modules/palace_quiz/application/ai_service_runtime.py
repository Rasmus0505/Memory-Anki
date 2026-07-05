"""Facade for palace quiz AI runtime helpers."""

from __future__ import annotations

from .ai_service_runtime_calls import (
    _call_logged_chat_completion as _call_logged_chat_completion,
    _call_logged_chat_completion_stream as _call_logged_chat_completion_stream,
)
from .ai_service_runtime_config import (
    _build_chat_config as _build_chat_config,
)

QuizStreamEvent = tuple[str, dict[str, object]]

__all__ = [
    "QuizStreamEvent",
    "_build_chat_config",
    "_call_logged_chat_completion",
    "_call_logged_chat_completion_stream",
]
