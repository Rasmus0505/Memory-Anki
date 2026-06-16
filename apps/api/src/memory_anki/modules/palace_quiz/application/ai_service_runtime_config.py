"""AI runtime configuration resolution for palace quiz flows."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
)
from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
)
from memory_anki.infrastructure.llm.config_helpers import has_non_empty_config
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    is_dashscope_compatible_provider,
    resolve_scenario_runtime,
    serialize_resolved_ai_runtime,
)

from ._question_utils import PalaceQuizAiError


def _build_chat_config(
    session: Session,
    *,
    scenario_key: str,
    ai_options: AiRuntimeOptions | None,
    temperature: float,
    timeout_seconds: float,
) -> tuple[OpenAICompatibleChatConfig, dict[str, Any] | None, dict[str, Any]]:
    runtime = resolve_scenario_runtime(session, scenario_key, ai_options=ai_options)
    runtime_api_key = runtime.api_key
    runtime_base_url = runtime.base_url
    if is_dashscope_compatible_provider(runtime.provider):
        if not has_non_empty_config(session, "dashscope_api_key"):
            runtime_api_key = str(DASHSCOPE_API_KEY or runtime.api_key or "").strip()
        if not has_non_empty_config(session, "dashscope_base_url"):
            runtime_base_url = str(DASHSCOPE_BASE_URL or runtime.base_url or "").strip()
    if not runtime_api_key:
        raise PalaceQuizAiError("未配置对应模型的 Provider API Key，暂时无法调用 AI。")
    resolved_ai = serialize_resolved_ai_runtime(runtime)
    return (
        OpenAICompatibleChatConfig(
            api_key=runtime_api_key,
            base_url=runtime_base_url,
            model=runtime.model,
            temperature=(temperature if runtime.supports_temperature else None),
            timeout_seconds=timeout_seconds,
        ),
        runtime.extra_payload,
        resolved_ai,
    )


__all__ = ["_build_chat_config"]
