from __future__ import annotations

from collections.abc import Generator

from .contracts import ImportStreamEvent


def stream_text_deltas_as_events[T](
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
