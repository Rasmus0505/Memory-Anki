from __future__ import annotations

from contextvars import ContextVar
from typing import Final

_request_id_var: Final[ContextVar[str | None]] = ContextVar("memory_anki_request_id", default=None)


def set_request_id(value: str | None) -> None:
    _request_id_var.set(value)


def get_request_id() -> str | None:
    return _request_id_var.get()
