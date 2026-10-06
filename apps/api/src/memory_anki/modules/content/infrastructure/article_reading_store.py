"""Config is cross-cutting storage; this namespace belongs exclusively to content."""
from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.dml import Insert, Update

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import Config


class SqlAlchemyArticleReadingStore:
    def __init__(self, session: Session) -> None:
        self._session = session

    @staticmethod
    def _key(owner_id: str) -> str:
        return f"article.reading.{owner_id}"

    def read(self, owner_id: str) -> str | None:
        return self._session.scalar(select(Config.value).where(Config.key == self._key(owner_id)))

    def compare_and_set(self, owner_id: str, previous: str | None, value: str) -> bool:
        key = self._key(owner_id)
        statement: Insert | Update
        if previous is None:
            statement = insert(Config).values(key=key, value=value, updated_at=utc_now_naive()).on_conflict_do_nothing(index_elements=[Config.key])
        else:
            statement = update(Config).where(Config.key == key, Config.value == previous).values(value=value, updated_at=utc_now_naive())
        result = self._session.execute(statement.returning(Config.id))
        return result.scalar_one_or_none() is not None
