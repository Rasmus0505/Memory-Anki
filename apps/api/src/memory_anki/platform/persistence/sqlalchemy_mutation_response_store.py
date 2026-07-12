from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.platform.application import MutationIdentity

_CONFIG_PREFIX = "api_mutation."


class SqlAlchemyMutationResponseStore:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, identity: MutationIdentity | None) -> Any | None:
        if identity is None:
            return None
        row = self._session.query(Config).filter_by(key=self._key(identity)).first()
        if row is None or not row.value:
            return None
        try:
            return json.loads(row.value)
        except Exception:
            return None

    def save(self, identity: MutationIdentity | None, payload: Any) -> None:
        if identity is None:
            return
        try:
            value = json.dumps(payload, ensure_ascii=False)
        except Exception:
            return
        row = self._session.query(Config).filter_by(key=self._key(identity)).first()
        if row is None:
            self._session.add(Config(key=self._key(identity), value=value))
        else:
            row.value = value
            row.updated_at = utc_now_naive()
        self._session.flush()

    @staticmethod
    def _key(identity: MutationIdentity) -> str:
        return f"{_CONFIG_PREFIX}{identity.operation_id}"
