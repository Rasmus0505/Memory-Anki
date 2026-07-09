"""AI runtime helpers for palace quiz flows."""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
)
from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    call_chat_completion_text,
    stream_chat_completion_text,
)
from memory_anki.infrastructure.llm.config_helpers import has_non_empty_config
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
)
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    is_dashscope_compatible_provider,
    resolve_scenario_runtime,
    serialize_resolved_ai_runtime,
)

from .._question_utils import PalaceQuizAiError

QuizStreamEvent = tuple[str, dict[str, object]]


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


def fail_ai_call_log_and_raise(
    *,
    log_id: str,
    config: OpenAICompatibleChatConfig,
    error: Exception,
) -> None:
    if isinstance(error, OpenAICompatibleProtocolError):
        fail_external_ai_call_log(
            log_id,
            error_payload={"type": "protocol_error", "message": str(error)},
        )
        raise PalaceQuizAiError(str(error)) from error
    if isinstance(error, OpenAICompatibleHttpError):
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "http_error",
                "status_code": error.status_code,
                "message": str(error),
                "response_body": error.response_body,
            },
        )
        detail = error.response_body.strip()
        raise PalaceQuizAiError(
            f"AI 调用失败：HTTP {error.status_code} {detail}".strip()
        ) from error
    if isinstance(error, OpenAICompatibleNetworkError):
        fail_external_ai_call_log(
            log_id,
            error_payload={
                "type": "network_error",
                "message": str(error),
                "reason": error.reason,
            },
        )
        raise PalaceQuizAiError(
            f"AI 网络异常：{error.reason}。当前目标地址：{config.base_url.rstrip('/')}/chat/completions"
        ) from error
    raise error


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
    "LoggedChatCompletionRequest",
    "QuizStreamEvent",
    "_build_chat_config",
    "_call_logged_chat_completion",
    "_call_logged_chat_completion_stream",
    "call_logged_chat_completion",
    "call_logged_chat_completion_stream",
    "complete_ai_call_log",
    "fail_ai_call_log_and_raise",
    "start_ai_call_log",
]
