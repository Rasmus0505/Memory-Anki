"""Error mapping and failure logging for palace quiz AI runtime calls."""

from __future__ import annotations

from memory_anki.infrastructure.llm import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
)
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    fail_external_ai_call_log,
)

from ._question_utils import PalaceQuizAiError


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


__all__ = ["fail_ai_call_log_and_raise"]
