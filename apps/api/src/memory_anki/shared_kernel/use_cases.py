from __future__ import annotations

from typing import Protocol, TypeVar

CommandT = TypeVar("CommandT", contravariant=True)
ResultT = TypeVar("ResultT", covariant=True)
QueryT = TypeVar("QueryT", contravariant=True)
ViewT = TypeVar("ViewT", covariant=True)
EventT = TypeVar("EventT", contravariant=True)


class CommandHandler(Protocol[CommandT, ResultT]):
    def __call__(self, command: CommandT) -> ResultT: ...


class QueryHandler(Protocol[QueryT, ViewT]):
    def __call__(self, query: QueryT) -> ViewT: ...


class EventHandler(Protocol[EventT]):
    def __call__(self, event: EventT) -> None: ...
