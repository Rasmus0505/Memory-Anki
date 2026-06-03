from __future__ import annotations

from typing import Generator, TypeVar

from .contracts import ImportStreamEvent

T = TypeVar("T")


def stream_text_deltas_as_events(
    *,
    generator: Generator[str, None, T],
    channel: str,
) -> Generator[ImportStreamEvent, None, T]:
    accumulated_text = ""
    while True:
        try:
            delta_text = next(generator)
        except StopIteration as exc:
            return exc.value
        if not delta_text:
            continue
        accumulated_text += delta_text
        yield {
            "event": "delta",
            "data": {
                "text": delta_text,
                "accumulated_text": accumulated_text,
                "channel": channel,
            },
        }
