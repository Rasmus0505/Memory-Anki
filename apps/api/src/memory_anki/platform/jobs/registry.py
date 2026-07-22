"""Job handler registry — W1 scaffold.

W2+ migrates mindmap_import, english generation, quiz generation, batch_generation
workers onto this registry with shared lease + ownerId/operationId.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol


class JobHandler(Protocol):
    kind: str

    def handle(self, payload: dict[str, Any]) -> dict[str, Any]:
        ...


@dataclass
class RegisteredHandler:
    kind: str
    handler: Callable[[dict[str, Any]], dict[str, Any]]


class JobRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, RegisteredHandler] = {}

    def register(
        self, kind: str, handler: Callable[[dict[str, Any]], dict[str, Any]]
    ) -> None:
        if kind in self._handlers:
            raise ValueError(f"job kind already registered: {kind}")
        self._handlers[kind] = RegisteredHandler(kind=kind, handler=handler)

    def get(self, kind: str) -> RegisteredHandler | None:
        return self._handlers.get(kind)

    def kinds(self) -> list[str]:
        return sorted(self._handlers)


_registry = JobRegistry()


def get_job_registry() -> JobRegistry:
    return _registry
