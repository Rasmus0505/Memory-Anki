from __future__ import annotations

from typing import Protocol, TypeVar

EntityT = TypeVar("EntityT")


class UnitOfWork(Protocol):
    """Transaction boundary owned by an application use case."""

    def commit(self) -> None: ...

    def rollback(self) -> None: ...

    def refresh(self, entity: EntityT) -> None: ...
