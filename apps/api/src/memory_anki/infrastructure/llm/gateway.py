from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Any, Literal, TypeVar, cast

from pydantic import BaseModel, ValidationError

from .openai_compatible import (
    OpenAICompatibleChatConfig,
    OpenAICompatibleError,
    OpenAICompatibleHttpError,
    OpenAICompatibleNetworkError,
    OpenAICompatibleProtocolError,
    _build_headers,
    _build_http_error,
    _build_network_error,
    _build_payload,
    _should_retry_http_status,
    _sleep_before_retry,
    build_chat_completions_url,
    extract_message_content_text,
    extract_message_reasoning_text,
)

StructuredOutputMode = Literal["json_schema", "json_object", "prompt_only"]
T = TypeVar("T")


class AiErrorKind(StrEnum):
    AUTH = "auth"
    RATE_LIMIT = "rate_limit"
    NETWORK = "network"
    TIMEOUT = "timeout"
    SERVER = "server"
    PROTOCOL = "protocol"
    STRUCTURE_VALIDATION = "structure_validation"
    CANCELLED = "cancelled"


class AiGatewayError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        kind: AiErrorKind,
        retryable: bool = False,
        log_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable
        self.log_id = log_id
        self.details = details or {}


@dataclass(frozen=True, slots=True)
class AiUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0


@dataclass(frozen=True, slots=True)
class StructuredOutputSpec:
    name: str
    json_schema: dict[str, Any]
    validator: type[BaseModel] | Callable[[Any], T]
    repair_prompt: str = "请只返回符合给定 JSON Schema 的 JSON，不要解释。"
    semantic_validator: Callable[[Any], None] | None = None


@dataclass(frozen=True, slots=True)
class AiRequest:
    scene: str
    config: OpenAICompatibleChatConfig
    messages: list[dict[str, Any]]
    provider: str = "openai-compatible"
    structured_output: StructuredOutputSpec | None = None
    structured_output_mode: StructuredOutputMode = "json_object"
    prompt_version_id: str | None = None
    extra_payload: dict[str, Any] | None = None
    legacy_response_format: dict[str, Any] | None = None
    allow_structure_repair: bool = True


@dataclass(frozen=True, slots=True)
class AiResult:
    text: str
    reasoning_text: str = ""
    finish_reason: str | None = None
    request_id: str | None = None
    usage: AiUsage = field(default_factory=AiUsage)
    duration_ms: int = 0
    first_token_ms: int | None = None
    attempts: int = 1
    structured_output_mode: StructuredOutputMode | None = None
    structured_value: Any = None
    repaired: bool = False


@dataclass(frozen=True, slots=True)
class ProviderAdapter:
    provider: str

    def response_format(
        self,
        mode: StructuredOutputMode,
        spec: StructuredOutputSpec,
    ) -> dict[str, Any] | None:
        if mode == "json_schema":
            return {
                "type": "json_schema",
                "json_schema": {"name": spec.name, "strict": True, "schema": spec.json_schema},
            }
        if mode == "json_object":
            return {"type": "json_object"}
        return None

    def parse_usage(self, payload: dict[str, Any]) -> AiUsage:
        raw_usage = payload.get("usage")
        usage: dict[str, Any] = raw_usage if isinstance(raw_usage, dict) else {}
        raw_prompt_details = usage.get("prompt_tokens_details")
        prompt_details: dict[str, Any] = (
            raw_prompt_details if isinstance(raw_prompt_details, dict) else {}
        )
        return AiUsage(
            input_tokens=int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
            cached_input_tokens=int(
                prompt_details.get("cached_tokens") or usage.get("cached_input_tokens") or 0
            ),
        )


def _extract_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index, character in enumerate(text[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def get_provider_adapter(provider: str) -> ProviderAdapter:
    return ProviderAdapter(provider=str(provider or "openai-compatible").strip().lower())


def _parse_completion_payload(payload: dict[str, Any], adapter: ProviderAdapter) -> AiResult:
    try:
        choice = payload["choices"][0]
        message = choice["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise OpenAICompatibleProtocolError("模型返回内容格式异常。") from exc
    text = extract_message_content_text(message.get("content"))
    reasoning = extract_message_reasoning_text(message)
    if not text and not reasoning:
        raise OpenAICompatibleProtocolError("模型返回内容为空。")
    return AiResult(
        text=(text or reasoning).strip(),
        reasoning_text=reasoning,
        finish_reason=str(choice.get("finish_reason") or "") or None,
        request_id=str(payload.get("id") or "") or None,
        usage=adapter.parse_usage(payload),
    )


def classify_ai_error(exc: BaseException) -> AiGatewayError:
    if isinstance(exc, AiGatewayError):
        return exc
    if isinstance(exc, OpenAICompatibleHttpError):
        if exc.status_code in {401, 403}:
            kind = AiErrorKind.AUTH
        elif exc.status_code == 429:
            kind = AiErrorKind.RATE_LIMIT
        elif exc.status_code >= 500:
            kind = AiErrorKind.SERVER
        else:
            kind = AiErrorKind.PROTOCOL
        return AiGatewayError(
            f"AI 服务请求失败（HTTP {exc.status_code}）。",
            kind=kind,
            retryable=_should_retry_http_status(exc.status_code),
            details={"status_code": exc.status_code, "response_body": exc.response_body},
        )
    if isinstance(exc, OpenAICompatibleNetworkError):
        is_timeout = "timed out" in exc.reason.lower() or "timeout" in exc.reason.lower()
        return AiGatewayError(
            "AI 服务请求超时。" if is_timeout else "无法连接 AI 服务。",
            kind=AiErrorKind.TIMEOUT if is_timeout else AiErrorKind.NETWORK,
            retryable=True,
            details={"reason": exc.reason},
        )
    if isinstance(exc, OpenAICompatibleProtocolError):
        return AiGatewayError(str(exc), kind=AiErrorKind.PROTOCOL)
    if isinstance(exc, OpenAICompatibleError):
        return AiGatewayError(str(exc), kind=AiErrorKind.PROTOCOL)
    return AiGatewayError(str(exc) or exc.__class__.__name__, kind=AiErrorKind.PROTOCOL)


def _is_unsupported_response_format(exc: BaseException) -> bool:
    if not isinstance(exc, OpenAICompatibleHttpError) or exc.status_code not in {400, 404, 422}:
        return False
    body = exc.response_body.lower()
    format_terms = ("response_format", "json_schema", "json object", "structured output")
    unsupported_terms = ("unsupported", "not support", "unknown", "invalid", "not available")
    return any(term in body for term in format_terms) and any(term in body for term in unsupported_terms)


def _request_once(request: AiRequest, *, mode: StructuredOutputMode | None) -> AiResult:
    adapter = get_provider_adapter(request.provider)
    response_format = request.legacy_response_format
    if mode and request.structured_output:
        response_format = adapter.response_format(mode, request.structured_output)
    payload = _build_payload(
        config=request.config,
        messages=request.messages,
        response_format=response_format,
        extra_payload=request.extra_payload,
        stream=False,
    )
    request_url = build_chat_completions_url(request.config.base_url)
    started = time.perf_counter()
    attempts = 0
    error: OpenAICompatibleError
    for attempt in range(max(0, request.config.max_retries) + 1):
        attempts = attempt + 1
        http_request = urllib.request.Request(
            request_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=_build_headers(request.config.api_key),
            method="POST",
        )
        try:
            with urllib.request.urlopen(http_request, timeout=request.config.timeout_seconds) as response:
                response_payload = json.loads(response.read().decode("utf-8", errors="ignore"))
                request_id = response.headers.get("x-request-id") or response.headers.get("request-id")
            parsed = _parse_completion_payload(response_payload, adapter)
            return replace(
                parsed,
                request_id=request_id or parsed.request_id,
                duration_ms=int((time.perf_counter() - started) * 1000),
                attempts=attempts,
                structured_output_mode=mode,
            )
        except urllib.error.HTTPError as exc:
            error = _build_http_error(exc, request_url)
            if not _should_retry_http_status(exc.code) or attempt >= max(0, request.config.max_retries):
                raise error from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            error = _build_network_error(exc, request_url)
            if attempt >= max(0, request.config.max_retries):
                raise error from exc
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            raise OpenAICompatibleProtocolError("模型返回内容格式异常。") from exc
        _sleep_before_retry(
            attempt,
            request.config.retry_backoff_seconds,
            retry_after_seconds=(
                error.retry_after_seconds if isinstance(error, OpenAICompatibleHttpError) else None
            ),
        )
    raise AssertionError("unreachable retry loop state")


def _validate_structured_text(text: str, spec: StructuredOutputSpec) -> Any:
    candidate = _extract_first_json_object(text) or text.strip()
    try:
        payload = json.loads(candidate)
        if isinstance(spec.validator, type) and issubclass(spec.validator, BaseModel):
            value: Any = spec.validator.model_validate(payload)
        else:
            value = cast(Callable[[Any], Any], spec.validator)(payload)
        if spec.semantic_validator:
            spec.semantic_validator(value)
        return value
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError) as exc:
        raise AiGatewayError(
            "模型结构化输出校验失败。",
            kind=AiErrorKind.STRUCTURE_VALIDATION,
            details={"validation_error": str(exc), "response_text": text},
        ) from exc


def _repair_structured_output(request: AiRequest, invalid_text: str) -> AiResult:
    assert request.structured_output is not None
    repair_request = replace(
        request,
        scene=f"{request.scene}:structure_repair",
        messages=[
            *request.messages,
            {"role": "assistant", "content": invalid_text},
            {
                "role": "user",
                "content": (
                    f"{request.structured_output.repair_prompt}\n"
                    f"JSON Schema:\n{json.dumps(request.structured_output.json_schema, ensure_ascii=False)}"
                ),
            },
        ],
        allow_structure_repair=False,
    )
    return replace(execute_ai_request(repair_request), repaired=True)


def execute_ai_request(request: AiRequest) -> AiResult:
    if not request.structured_output:
        modes: list[StructuredOutputMode | None] = [None]
    elif request.structured_output_mode == "json_schema":
        modes = ["json_schema", "json_object", "prompt_only"]
    elif request.structured_output_mode == "json_object":
        modes = ["json_object", "prompt_only"]
    else:
        modes = ["prompt_only"]

    last_error: BaseException | None = None
    for index, mode in enumerate(modes):
        try:
            result = _request_once(request, mode=mode)
            if not request.structured_output:
                return result
            try:
                value = _validate_structured_text(result.text, request.structured_output)
                return replace(result, structured_value=value)
            except AiGatewayError:
                if request.allow_structure_repair:
                    return _repair_structured_output(request, result.text)
                raise
        except BaseException as exc:
            last_error = exc
            if index < len(modes) - 1 and _is_unsupported_response_format(exc):
                continue
            raise classify_ai_error(exc) from exc
    assert last_error is not None
    raise classify_ai_error(last_error)


__all__ = [
    "AiErrorKind",
    "AiGatewayError",
    "AiRequest",
    "AiResult",
    "AiUsage",
    "ProviderAdapter",
    "StructuredOutputMode",
    "StructuredOutputSpec",
    "classify_ai_error",
    "execute_ai_request",
    "get_provider_adapter",
]
