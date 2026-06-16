"""Facade for palace quiz AI runtime helpers."""

from __future__ import annotations

from .ai_service_runtime_calls import (
    _call_logged_chat_completion as _call_logged_chat_completion,
    _call_logged_chat_completion_stream as _call_logged_chat_completion_stream,
)
from .ai_service_runtime_config import (
    _build_chat_config as _build_chat_config,
)
from memory_anki.modules.knowledge.application.subject_document_service import (
    render_selected_pdf_pages as render_selected_pdf_pages,
)

QuizStreamEvent = tuple[str, dict[str, object]]

__all__ = [
    "QuizStreamEvent",
    "_build_chat_config",
    "_call_logged_chat_completion",
    "_call_logged_chat_completion_stream",
    "render_selected_pdf_pages",
]
