"""Simple synchronous in-process event bus.

Used for write-time projection updates (e.g. NodesRated -> due rollup refresh).
Not a distributed message queue.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from typing import Any, TypeVar

E = TypeVar("E")
Handler = Callable[[Any], None]


class EventBus:
    def __init__(self) -> None:
        self._handlers: defaultdict[type, list[Handler]] = defaultdict(list)

    def subscribe(self, event_type: type[E], handler: Callable[[E], None]) -> None:
        self._handlers[event_type].append(handler)  # type: ignore[arg-type]

    def publish(self, event: Any) -> None:
        for handler in list(self._handlers.get(type(event), [])):
            handler(event)


_bus = EventBus()


def get_event_bus() -> EventBus:
    return _bus


def subscribe(event_type: type[E], handler: Callable[[E], None]) -> None:
    _bus.subscribe(event_type, handler)


def publish(event: Any) -> None:
    _bus.publish(event)
