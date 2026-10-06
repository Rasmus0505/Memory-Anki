"""Flush-only participant for composing existing content commands atomically."""
from typing import TypeVar

from sqlalchemy.orm import Session

EntityT = TypeVar("EntityT")


class ArticlePackageParticipant:
    def __init__(self, session: Session) -> None:
        self.session = session

    def commit(self) -> None:
        self.session.flush()

    def rollback(self) -> None:
        self.session.rollback()

    def refresh(self, entity: EntityT) -> None:
        self.session.flush()
        self.session.refresh(entity)
