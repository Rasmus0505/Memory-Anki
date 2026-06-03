from __future__ import annotations

import pytest

from memory_anki.infrastructure.llm import openai_compatible as client


def test_extract_chat_completion_text_from_plain_string_body() -> None:
    body = '{"choices":[{"message":{"content":"你好"}}]}'

    assert client.extract_chat_completion_text_from_body(body) == "你好"


def test_extract_chat_completion_text_from_structured_content_body() -> None:
    body = (
        '{"choices":[{"message":{"content":['
        '{"type":"text","text":"第一行"},'
        '{"type":"output_text","text":"第二行"}'
        ']}}]}'
    )

    assert client.extract_chat_completion_text_from_body(body) == "第一行\n第二行"


def test_parse_chat_completion_stream_accumulates_delta_chunks() -> None:
    class FakeResponse:
        def __iter__(self):
            return iter(
                [
                    b'data: {"choices":[{"delta":{"content":"\xe7\xac\xac\xe4\xb8\x80"}}]}\n',
                    b"\n",
                    b'data: {"choices":[{"delta":{"content":"\xe7\xab\xa0"}}]}\n',
                    b"data: [DONE]\n",
                ]
            )

        def read(self):
            return b""

    generator = client.parse_chat_completion_stream(FakeResponse())
    chunks: list[str] = []

    while True:
        try:
            chunks.append(next(generator))
        except StopIteration as stop:
            final_text = stop.value
            break

    assert chunks == ["第一", "章"]
    assert final_text == "第一章"


def test_parse_chat_completion_stream_falls_back_to_non_stream_body() -> None:
    class FakeResponse:
        def __iter__(self):
            return iter(['{"choices":[{"message":{"content":"直接返回"}}]}'.encode("utf-8")])

        def read(self):
            return b""

    generator = client.parse_chat_completion_stream(FakeResponse())

    with pytest.raises(StopIteration) as stop:
        next(generator)

    assert stop.value.value == "直接返回"
