"""Job handler registry — unbuilt scaffold, currently unused.

STATUS: this module has no callers and no tests. It is a placeholder for the
"target shared job lease/handler infrastructure" line in
``docs/architecture/README.md``, and it does NOT provide a lease.

An earlier revision of this docstring claimed that a later step would migrate
mindmap_import, english generation, quiz generation and batch_generation workers
"onto this registry with shared lease + ownerId/operationId". No such migration
happened and no lease exists anywhere in the backend, so that sentence invited the
false assumption that background work is already serialized.

What actually runs background work today, each with its own stop event and its own
reentrancy guard:
  - ``modules/backups/application/backup_lifecycle.py`` — 300 s periodic loop
    (``create_rolling_backup`` takes a module lock and ``storage_write_lock``)
  - ``core/runtime_activity.py`` — instance heartbeat loop
  - ``app/startup_warmup.py`` — one-shot warmup thread

These are three small loops in a single-process SQLite app. A scheduler dependency
plus a database-backed lease would be new infrastructure with no failure mode that
justifies it. Either delete this module together with the README target line, or
implement the registry alongside a real consumer — do not add a lease on its own.
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
