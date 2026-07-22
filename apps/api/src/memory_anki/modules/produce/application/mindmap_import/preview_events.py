from __future__ import annotations

from typing import Any

from .contracts import ImportStreamEvent


def stream_event(event: str, data: dict[str, Any]) -> ImportStreamEvent:
    return {"event": event, "data": data}


def build_status_event(
    *,
    phase: str,
    message: str,
    step: int,
    total_steps: int,
) -> ImportStreamEvent:
    return stream_event(
        "status",
        {
            "phase": phase,
            "message": message,
            "step": step,
            "total_steps": total_steps,
        },
    )


def build_delta_event(
    *,
    text: str,
    accumulated_text: str,
    channel: str,
) -> ImportStreamEvent:
    return stream_event(
        "delta",
        {
            "text": text,
            "accumulated_text": accumulated_text,
            "channel": channel,
        },
    )


def build_result_event(data: dict[str, Any]) -> ImportStreamEvent:
    return stream_event("result", data)


def build_error_event(error: str) -> ImportStreamEvent:
    return stream_event("error", {"error": error})
