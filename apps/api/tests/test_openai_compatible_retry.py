from __future__ import annotations

import io
import urllib.error
from collections.abc import Iterator
from unittest.mock import Mock

import pytest

from memory_anki.infrastructure.llm import openai_compatible as client


def _config() -> client.OpenAICompatibleChatConfig:
    return client.OpenAICompatibleChatConfig(
        api_key="test-key",
        base_url="https://llm.example/v1",
        model="test-model",
        retry_backoff_seconds=0,
    )


class FakeResponse:
    def __init__(self, body: bytes):
        self.body = body

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


class FakeStreamResponse:
    def __init__(self, lines: list[bytes], *, fail_after_first: bool = False):
        self.lines = lines
        self.fail_after_first = fail_after_first
        self.closed = False

    def __iter__(self) -> Iterator[bytes]:
        yield self.lines[0]
        if self.fail_after_first:
            raise urllib.error.URLError("stream broke")
        yield from self.lines[1:]

    def read(self) -> bytes:
        return b""

    def close(self) -> None:
        self.closed = True


def _http_error(status_code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url="https://llm.example/v1/chat/completions",
        code=status_code,
        msg="error",
        hdrs={},
        fp=io.BytesIO(b'{"error":"boom"}'),
    )


def test_call_chat_completion_retries_network_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    urlopen = Mock(
        side_effect=[
            urllib.error.URLError("boom"),
            urllib.error.URLError("still down"),
            FakeResponse(b'{"choices":[{"message":{"content":"OK"}}]}'),
        ]
    )
    monkeypatch.setattr(client.urllib.request, "urlopen", urlopen)

    result = client.call_chat_completion_text(config=_config(), messages=[])

    assert result == "OK"
    assert urlopen.call_count == 3


def test_call_chat_completion_does_not_retry_auth_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    urlopen = Mock(side_effect=_http_error(401))
    monkeypatch.setattr(client.urllib.request, "urlopen", urlopen)

    with pytest.raises(client.OpenAICompatibleHttpError) as exc:
        client.call_chat_completion_text(config=_config(), messages=[])

    assert exc.value.is_auth_error
    assert urlopen.call_count == 1


def test_stream_chat_completion_retries_before_stream_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream_response = FakeStreamResponse(
        [
            b'data: {"choices":[{"delta":{"content":"he"}}]}\n',
            b'data: {"choices":[{"delta":{"content":"llo"}}]}\n',
            b"data: [DONE]\n",
        ]
    )
    urlopen = Mock(side_effect=[urllib.error.URLError("boom"), stream_response])
    monkeypatch.setattr(client.urllib.request, "urlopen", urlopen)

    chunks = list(client.stream_chat_completion_text(config=_config(), messages=[]))

    assert chunks == ["he", "llo"]
    assert stream_response.closed
    assert urlopen.call_count == 2


def test_stream_chat_completion_does_not_retry_after_stream_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream_response = FakeStreamResponse(
        [b'data: {"choices":[{"delta":{"content":"partial"}}]}\n'],
        fail_after_first=True,
    )
    urlopen = Mock(return_value=stream_response)
    monkeypatch.setattr(client.urllib.request, "urlopen", urlopen)
    generator = client.stream_chat_completion_text(config=_config(), messages=[])

    assert next(generator) == "partial"
    with pytest.raises(urllib.error.URLError):
        next(generator)
    assert stream_response.closed
    assert urlopen.call_count == 1
