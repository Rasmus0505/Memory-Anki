from __future__ import annotations

import io
import json
import urllib.error
from email.message import Message
from unittest.mock import patch

import pytest
from pydantic import BaseModel

from memory_anki.infrastructure.llm.gateway import (
    AiErrorKind,
    AiGatewayError,
    AiRequest,
    StructuredOutputSpec,
    execute_ai_request,
)
from memory_anki.infrastructure.llm.openai_compatible import OpenAICompatibleChatConfig


class ProbePayload(BaseModel):
    ok: bool


class FakeResponse:
    def __init__(self, payload: dict, headers: dict[str, str] | None = None):
        self.payload = payload
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


def completion(content: str, *, usage: dict | None = None) -> dict:
    return {
        "id": "req-body",
        "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
        "usage": usage or {},
    }


def config() -> OpenAICompatibleChatConfig:
    return OpenAICompatibleChatConfig(
        api_key="test",
        base_url="https://example.test/v1",
        model="model",
        max_retries=0,
    )


def spec() -> StructuredOutputSpec:
    return StructuredOutputSpec(
        name="probe",
        json_schema=ProbePayload.model_json_schema(),
        validator=ProbePayload,
    )


def http_error(status: int, body: str, headers: dict[str, str] | None = None):
    message = Message()
    for key, value in (headers or {}).items():
        message[key] = value
    return urllib.error.HTTPError(
        "https://example.test/v1/chat/completions",
        status,
        "error",
        message,
        io.BytesIO(body.encode()),
    )


def test_gateway_extracts_usage_and_request_id():
    payload = completion(
        '{"ok": true}',
        usage={
            "prompt_tokens": 10,
            "completion_tokens": 3,
            "prompt_tokens_details": {"cached_tokens": 4},
        },
    )
    with patch("urllib.request.urlopen", return_value=FakeResponse(payload, {"x-request-id": "header-id"})):
        result = execute_ai_request(
            AiRequest(
                scene="test",
                config=config(),
                messages=[{"role": "user", "content": "test"}],
                structured_output=spec(),
                structured_output_mode="json_schema",
            )
        )
    assert result.request_id == "header-id"
    assert result.finish_reason == "stop"
    assert result.usage.input_tokens == 10
    assert result.usage.output_tokens == 3
    assert result.usage.cached_input_tokens == 4
    assert result.structured_value.ok is True


def test_gateway_downgrades_only_unsupported_response_format():
    calls = []

    def fake_urlopen(request, timeout):
        body = json.loads(request.data)
        calls.append(body.get("response_format"))
        if len(calls) == 1:
            raise http_error(400, "unsupported response_format json_schema")
        return FakeResponse(completion('{"ok": true}'))

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        result = execute_ai_request(
            AiRequest(
                scene="test",
                config=config(),
                messages=[{"role": "user", "content": "test"}],
                structured_output=spec(),
                structured_output_mode="json_schema",
            )
        )
    assert calls[0]["type"] == "json_schema"
    assert calls[1] == {"type": "json_object"}
    assert result.structured_output_mode == "json_object"


def test_gateway_does_not_downgrade_auth_errors():
    calls = 0

    def fake_urlopen(_request, timeout):
        nonlocal calls
        calls += 1
        raise http_error(401, "invalid api key")

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        with pytest.raises(AiGatewayError) as raised:
            execute_ai_request(
                AiRequest(
                    scene="test",
                    config=config(),
                    messages=[{"role": "user", "content": "test"}],
                    structured_output=spec(),
                    structured_output_mode="json_schema",
                )
            )
    assert raised.value.kind == AiErrorKind.AUTH
    assert calls == 1


def test_gateway_repairs_invalid_structure_once():
    responses = [FakeResponse(completion("not-json")), FakeResponse(completion('{"ok": true}'))]
    with patch("urllib.request.urlopen", side_effect=responses):
        result = execute_ai_request(
            AiRequest(
                scene="test",
                config=config(),
                messages=[{"role": "user", "content": "test"}],
                structured_output=spec(),
                structured_output_mode="json_object",
            )
        )
    assert result.repaired is True
    assert result.structured_value.ok is True


def test_retry_after_is_used_by_legacy_transport():
    from memory_anki.infrastructure.llm.openai_compatible import call_chat_completion_text

    retrying_config = OpenAICompatibleChatConfig(
        api_key="test",
        base_url="https://example.test/v1",
        model="model",
        max_retries=1,
        retry_backoff_seconds=99,
    )
    responses = [http_error(429, "rate limited", {"Retry-After": "2"}), FakeResponse(completion("OK"))]
    with (
        patch("urllib.request.urlopen", side_effect=responses),
        patch("time.sleep") as sleep,
    ):
        assert call_chat_completion_text(
            config=retrying_config,
            messages=[{"role": "user", "content": "test"}],
        ) == "OK"
    sleep.assert_called_once_with(2.0)
