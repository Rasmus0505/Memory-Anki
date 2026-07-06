"""Facade for palace-quiz AI runtime helpers and public generation entrypoints."""

from __future__ import annotations

from memory_anki.core.config import DASHSCOPE_API_KEY as DASHSCOPE_API_KEY
from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
)
from memory_anki.infrastructure.llm import (
    stream_chat_completion_text as stream_chat_completion_text,
)

from . import ai_service_runtime_config as _runtime_config
from . import ai_service_runtime_stream as _runtime_stream
from ._question_utils import (
    PalaceQuizAiError as PalaceQuizAiError,
)
from ._question_utils import (
    build_generation_source_meta as _build_generation_source_meta,
)
from ._question_utils import (
    normalize_generated_question_drafts as _normalize_generated_question_drafts,
)
from .ai_service_runtime import (
    QuizStreamEvent as QuizStreamEvent,
)
from .ai_service_runtime import (
    _build_chat_config as _runtime_build_chat_config,
)
from .ai_service_runtime import (
    _call_logged_chat_completion as _runtime_call_logged_chat_completion,
)
from .ai_service_runtime import (
    _call_logged_chat_completion_stream as _runtime_call_logged_chat_completion_stream,
)
from .quiz_generation_service import (
    explain_question,
    generate_quiz_preview_from_chapter_outline,
    generate_quiz_preview_from_images,
    generate_quiz_preview_from_review_mindmap,
    generate_quiz_preview_from_text_files,
    generate_short_answer_feedback,
)

_FACADE_TRANSPORT_MODEL_KEY = "facade-overridden-transport"


def _sync_facade_dependencies() -> None:
    _runtime_config.DASHSCOPE_API_KEY = DASHSCOPE_API_KEY
    _runtime_stream.stream_chat_completion_text = stream_chat_completion_text


def _build_chat_config(*args, **kwargs):
    _sync_facade_dependencies()
    try:
        return _runtime_build_chat_config(*args, **kwargs)
    except PalaceQuizAiError as error:
        if not _can_defer_config_to_overridden_transport(error):
            raise
        return _build_overridden_transport_chat_config(
            scenario_key=kwargs.get("scenario_key"),
            temperature=kwargs.get("temperature"),
            timeout_seconds=kwargs.get("timeout_seconds", 90),
        )


def _call_logged_chat_completion(*args, **kwargs):
    _sync_facade_dependencies()
    return _runtime_call_logged_chat_completion(*args, **kwargs)


def _call_logged_chat_completion_stream(*args, **kwargs):
    _sync_facade_dependencies()
    return _runtime_call_logged_chat_completion_stream(*args, **kwargs)


_DEFAULT_CALL_LOGGED_CHAT_COMPLETION = _call_logged_chat_completion
_DEFAULT_CALL_LOGGED_CHAT_COMPLETION_STREAM = _call_logged_chat_completion_stream


def _is_completion_transport_overridden() -> bool:
    return (
        globals().get("_call_logged_chat_completion") is not _DEFAULT_CALL_LOGGED_CHAT_COMPLETION
        or globals().get("_call_logged_chat_completion_stream") is not _DEFAULT_CALL_LOGGED_CHAT_COMPLETION_STREAM
    )


def _can_defer_config_to_overridden_transport(error: PalaceQuizAiError) -> bool:
    return "API Key" in str(error) and _is_completion_transport_overridden()


def _build_overridden_transport_chat_config(
    *,
    scenario_key: object,
    temperature: object,
    timeout_seconds: object,
):
    return (
        OpenAICompatibleChatConfig(
            api_key=_FACADE_TRANSPORT_MODEL_KEY,
            base_url="",
            model=_FACADE_TRANSPORT_MODEL_KEY,
            temperature=temperature if isinstance(temperature, int | float) else None,
            timeout_seconds=float(timeout_seconds or 90),
        ),
        None,
        {
            "scene_key": str(scenario_key or ""),
            "scene_label": "Facade overridden transport",
            "model_key": _FACADE_TRANSPORT_MODEL_KEY,
            "model_label": "Facade overridden transport",
            "api_model": _FACADE_TRANSPORT_MODEL_KEY,
            "provider": "facade_override",
            "provider_label": "Facade override",
            "model_type": "text",
            "model_type_label": "Text",
            "has_vision": False,
            "thinking_enabled": False,
        },
    )


def classify_existing_quiz_questions_to_mini_palaces(*args, **kwargs):
    from .quiz_grouping_service import classify_existing_quiz_questions_to_mini_palaces as impl

    return impl(*args, **kwargs)


__all__ = [
    "DASHSCOPE_API_KEY",
    "PalaceQuizAiError",
    "QuizStreamEvent",
    "_build_chat_config",
    "_build_generation_source_meta",
    "_call_logged_chat_completion",
    "_call_logged_chat_completion_stream",
    "_normalize_generated_question_drafts",
    "classify_existing_quiz_questions_to_mini_palaces",
    "explain_question",
    "generate_quiz_preview_from_chapter_outline",
    "generate_quiz_preview_from_images",
    "generate_quiz_preview_from_review_mindmap",
    "generate_quiz_preview_from_text_files",
    "generate_short_answer_feedback",
    "stream_chat_completion_text",
]
