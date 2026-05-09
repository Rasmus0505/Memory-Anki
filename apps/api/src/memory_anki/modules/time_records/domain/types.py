from __future__ import annotations

from typing import Literal, TypedDict

SessionKind = Literal["palace_edit", "practice", "review"]
SessionCompletionMethod = Literal[
    "manual_complete",
    "auto_complete",
    "restart",
    "left_page",
    "saved",
]
SessionEventType = Literal[
    "start",
    "pause",
    "resume",
    "complete",
    "adjust_duration",
    "enter_edit_mode",
    "exit_edit_mode",
    "restart",
    "auto_complete",
    "manual_complete",
]


class SessionEventRecord(TypedDict, total=False):
    type: SessionEventType
    at: str
    meta: dict[str, bool | int | float | str | None]
