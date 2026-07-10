from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.request
from collections.abc import Generator
from dataclasses import dataclass
from typing import Any

DEFAULT_PROTOCOL_ERROR_MESSAGE = "模型返回内容格式异常。"
DEFAULT_EMPTY_RESPONSE_MESSAGE = "模型返回内容为空。"


@dataclass(frozen=True, slots=True)
class OpenAICompatibleChatConfig:
    api_key: str
    base_url: str
    model: str
    temperature: float | None = 0.0
    timeout_seconds: float = 90.0
    max_retries: int = 2
    retry_backoff_seconds: float = 1.0


class OpenAICompatibleError(RuntimeError):
    pass


class OpenAICompatibleProtocolError(OpenAICompatibleError):
    pass


class OpenAICompatibleHttpError(OpenAICompatibleError):
    def __init__(
        self,
        *,
        status_code: int,
        request_url: str,
        response_body: str,
        retry_after_seconds: float | None = None,
    ):
        self.status_code = status_code
        self.request_url = request_url
        self.response_body = response_body
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"HTTP {status_code}")

    @property
    def is_auth_error(self) -> bool:
        return self.status_code in {401, 403}

    @property
    def is_rate_limited(self) -> bool:
        return self.status_code == 429


class OpenAICompatibleNetworkError(OpenAICompatibleError):
    def __init__(self, *, request_url: str, reason: str):
        self.request_url = request_url
        self.reason = reason
        super().__init__(reason)


def build_chat_completions_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/chat/completions"


def extract_message_content_text(content: Any) -> str:
    if isinstance(content, list):
        text_parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type in {"text", "output_text"} and isinstance(item.get("text"), str):
                text_parts.append(item["text"])
                continue
            if item_type == "text_delta" and isinstance(item.get("text"), str):
                text_parts.append(item["text"])
        return "\n".join(part for part in text_parts if part).strip()
    if isinstance(content, str):
        return content.strip()
    return ""


def extract_message_reasoning_text(message: Any) -> str:
    if not isinstance(message, dict):
        return ""
    reasoning_content = message.get("reasoning_content")
    if isinstance(reasoning_content, str):
        return reasoning_content.strip()
    return ""


def extract_chat_completion_stream_delta(
    payload_text: str,
    *,
    protocol_error_message: str = DEFAULT_PROTOCOL_ERROR_MESSAGE,
) -> str:
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError as exc:
        raise OpenAICompatibleProtocolError(protocol_error_message) from exc

    try:
        choice = payload["choices"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise OpenAICompatibleProtocolError(protocol_error_message) from exc

    delta = choice.get("delta")
    if isinstance(delta, dict):
        text = extract_message_content_text(delta.get("content"))
        if text:
            return text

    message = choice.get("message")
    if isinstance(message, dict):
        content_text = extract_message_content_text(message.get("content"))
        if content_text:
            return content_text
        return extract_message_reasoning_text(message)

    return ""


def extract_chat_completion_text_from_body(
    response_body: str,
    *,
    protocol_error_message: str = DEFAULT_PROTOCOL_ERROR_MESSAGE,
    empty_response_message: str = DEFAULT_EMPTY_RESPONSE_MESSAGE,
) -> str:
    try:
        parsed = json.loads(response_body)
        message = parsed["choices"][0]["message"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise OpenAICompatibleProtocolError(protocol_error_message) from exc

    content_text = extract_message_content_text(message.get("content"))
    if not content_text:
        content_text = extract_message_reasoning_text(message)
    if not content_text:
        raise OpenAICompatibleProtocolError(empty_response_message)
    return content_text.strip()


def parse_chat_completion_stream(
    response: Any,
    *,
    protocol_error_message: str = DEFAULT_PROTOCOL_ERROR_MESSAGE,
    empty_response_message: str = DEFAULT_EMPTY_RESPONSE_MESSAGE,
) -> Generator[str, None, str]:
    saw_stream_payload = False
    accumulated_text = ""
    fallback_chunks: list[str] = []
    for raw_line in response:
        if isinstance(raw_line, bytes):
            line = raw_line.decode("utf-8", errors="ignore")
        else:
            line = str(raw_line)
        stripped = line.strip()
        if not stripped:
            continue
        if not stripped.startswith("data:"):
            fallback_chunks.append(line)
            continue
        payload_text = stripped[5:].strip()
        if not payload_text:
            continue
        saw_stream_payload = True
        if payload_text == "[DONE]":
            break
        delta_text = extract_chat_completion_stream_delta(
            payload_text,
            protocol_error_message=protocol_error_message,
        )
        if not delta_text:
            continue
        accumulated_text += delta_text
        yield delta_text

    if not saw_stream_payload:
        fallback_body = "".join(fallback_chunks)
        if hasattr(response, "read"):
            try:
                trailing = response.read()
            except Exception:
                trailing = b""
            if isinstance(trailing, bytes):
                fallback_body += trailing.decode("utf-8", errors="ignore")
            elif trailing:
                fallback_body += str(trailing)
        if not fallback_body.strip():
            raise OpenAICompatibleProtocolError(empty_response_message)
        return extract_chat_completion_text_from_body(
            fallback_body,
            protocol_error_message=protocol_error_message,
            empty_response_message=empty_response_message,
        )

    if not accumulated_text.strip():
        raise OpenAICompatibleProtocolError(empty_response_message)
    return accumulated_text.strip()


def call_chat_completion_text(
    *,
    config: OpenAICompatibleChatConfig,
    messages: list[dict[str, Any]],
    response_format: dict[str, Any] | None = None,
    extra_payload: dict[str, Any] | None = None,
    stream: bool = False,
) -> str:
    if stream:
        generator = stream_chat_completion_text(
            config=config,
            messages=messages,
            response_format=response_format,
            extra_payload=extra_payload,
        )
        while True:
            try:
                next(generator)
            except StopIteration as exc:
                return exc.value

    payload = _build_payload(
        config=config,
        messages=messages,
        response_format=response_format,
        extra_payload=extra_payload,
        stream=False,
    )
    request_url = build_chat_completions_url(config.base_url)
    for attempt in range(max(0, config.max_retries) + 1):
        request = urllib.request.Request(
            request_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=_build_headers(config.api_key),
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
                response_body = response.read().decode("utf-8", errors="ignore")
            return extract_chat_completion_text_from_body(response_body)
        except urllib.error.HTTPError as exc:
            error = _build_http_error(exc, request_url)
            if not _should_retry_http_status(exc.code) or attempt >= max(0, config.max_retries):
                raise error from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            error = _build_network_error(exc, request_url)
            if attempt >= max(0, config.max_retries):
                raise error from exc
        _sleep_before_retry(
            attempt,
            config.retry_backoff_seconds,
            retry_after_seconds=(
                error.retry_after_seconds
                if isinstance(error, OpenAICompatibleHttpError)
                else None
            ),
        )
    raise AssertionError("unreachable retry loop state")


def stream_chat_completion_text(
    *,
    config: OpenAICompatibleChatConfig,
    messages: list[dict[str, Any]],
    response_format: dict[str, Any] | None = None,
    extra_payload: dict[str, Any] | None = None,
) -> Generator[str, None, str]:
    payload = _build_payload(
        config=config,
        messages=messages,
        response_format=response_format,
        extra_payload=extra_payload,
        stream=True,
    )
    request_url = build_chat_completions_url(config.base_url)
    for attempt in range(max(0, config.max_retries) + 1):
        request = urllib.request.Request(
            request_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=_build_headers(config.api_key, accept_sse=True),
            method="POST",
        )
        try:
            response = urllib.request.urlopen(request, timeout=config.timeout_seconds)
        except urllib.error.HTTPError as exc:
            error = _build_http_error(exc, request_url)
            if not _should_retry_http_status(exc.code) or attempt >= max(0, config.max_retries):
                raise error from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            error = _build_network_error(exc, request_url)
            if attempt >= max(0, config.max_retries):
                raise error from exc
        else:
            try:
                return (yield from parse_chat_completion_stream(response))
            finally:
                response.close()
        _sleep_before_retry(
            attempt,
            config.retry_backoff_seconds,
            retry_after_seconds=(
                error.retry_after_seconds
                if isinstance(error, OpenAICompatibleHttpError)
                else None
            ),
        )
    raise AssertionError("unreachable retry loop state")


def _build_payload(
    *,
    config: OpenAICompatibleChatConfig,
    messages: list[dict[str, Any]],
    response_format: dict[str, Any] | None,
    extra_payload: dict[str, Any] | None,
    stream: bool,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
    }
    if config.temperature is not None:
        payload["temperature"] = config.temperature
    if stream:
        payload["stream"] = True
    if response_format is not None:
        payload["response_format"] = response_format
    if extra_payload:
        payload.update(extra_payload)
    return payload


def _build_headers(api_key: str, *, accept_sse: bool = False) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if accept_sse:
        headers["Accept"] = "text/event-stream"
    return headers


def _build_http_error(exc: urllib.error.HTTPError, request_url: str) -> OpenAICompatibleHttpError:
    retry_after_seconds: float | None = None
    retry_after = exc.headers.get("Retry-After") if exc.headers else None
    if retry_after:
        try:
            retry_after_seconds = max(0.0, float(retry_after))
        except (TypeError, ValueError):
            retry_after_seconds = None
    return OpenAICompatibleHttpError(
        status_code=exc.code,
        request_url=request_url,
        response_body=exc.read().decode("utf-8", errors="ignore"),
        retry_after_seconds=retry_after_seconds,
    )


def _build_network_error(exc: BaseException, request_url: str) -> OpenAICompatibleNetworkError:
    return OpenAICompatibleNetworkError(
        request_url=request_url,
        reason=str(getattr(exc, "reason", exc)) or exc.__class__.__name__,
    )


def _should_retry_http_status(status_code: int) -> bool:
    return status_code in {408, 409, 429} or 500 <= status_code <= 599


def _sleep_before_retry(
    attempt: int,
    base_seconds: float,
    *,
    retry_after_seconds: float | None = None,
) -> None:
    if retry_after_seconds is not None:
        delay = retry_after_seconds
    else:
        exponential = max(0.0, base_seconds) * (2**attempt)
        delay = exponential + random.uniform(0.0, max(0.05, exponential * 0.25))
    if delay > 0:
        time.sleep(delay)
