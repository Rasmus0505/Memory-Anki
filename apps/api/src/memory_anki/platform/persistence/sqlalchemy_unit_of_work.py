from __future__ import annotations

from typing import TypeVar

from sqlalchemy.orm import Session

EntityT = TypeVar("EntityT")


class SqlAlchemyUnitOfWork:
    """SQLAlchemy adapter for application-owned transaction boundaries."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def commit(self) -> None:
        self._session.commit()

    def rollback(self) -> None:
        self._session.rollback()

    def refresh(self, entity: EntityT) -> None:
        self._session.refresh(entity)
