"""Article position is an independent aggregate, never an editor mutation."""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Protocol

from pydantic import BaseModel, ConfigDict, Field

from memory_anki.platform.application import UnitOfWork

OWNER_PATTERN = r"^(palace|knowledge-subject):[1-9][0-9]{0,18}$"
ShortIdentity = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^\S+$")]


class ArticleReadingWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    node_uid: ShortIdentity
    block_offset: float | None = Field(default=None, ge=0, le=1)
    client_id: ShortIdentity
    operation_id: ShortIdentity
    client_sequence: int = Field(ge=1, le=9007199254740991)
    expected_revision: int = Field(ge=0, le=9007199254740991)


class ArticleReadingCursor(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    owner_id: str = Field(pattern=OWNER_PATTERN)
    node_uid: ShortIdentity
    block_offset: float | None = Field(default=None, ge=0, le=1)
    updated_at: datetime
    client_id: ShortIdentity
    operation_id: ShortIdentity
    client_sequence: int = Field(ge=1)
    revision: int = Field(ge=1)


class ArticleReadingResponse(BaseModel):
    owner_id: str = Field(pattern=OWNER_PATTERN)
    cursor: ArticleReadingCursor | None


class ArticleReadingStore(Protocol):
    def read(self, owner_id: str) -> str | None: ...

    def compare_and_set(self, owner_id: str, previous: str | None, value: str) -> bool: ...


class ArticleReadingConflict(Exception):
    def __init__(self, snapshot: ArticleReadingResponse) -> None:
        super().__init__("Reading cursor changed; reload before saving again")
        self.snapshot = snapshot


def _validate_owner(owner_id: str) -> None:
    if not re.fullmatch(OWNER_PATTERN, owner_id):
        raise ValueError("Invalid article document owner")


def _snapshot(owner_id: str, raw: str | None) -> ArticleReadingResponse:
    cursor = ArticleReadingCursor.model_validate_json(raw) if raw is not None else None
    if cursor is not None and cursor.owner_id != owner_id:
        raise ValueError("Stored reading cursor owner mismatch")
    return ArticleReadingResponse(owner_id=owner_id, cursor=cursor)


def get_article_reading(store: ArticleReadingStore, owner_id: str) -> ArticleReadingResponse:
    _validate_owner(owner_id)
    return _snapshot(owner_id, store.read(owner_id))


def save_article_reading(
    store: ArticleReadingStore,
    owner_id: str,
    command: ArticleReadingWrite,
    *,
    uow: UnitOfWork,
) -> ArticleReadingResponse:
    _validate_owner(owner_id)
    raw = store.read(owner_id)
    snapshot = _snapshot(owner_id, raw)
    current = snapshot.cursor
    if current is not None:
        if current.client_id == command.client_id and current.operation_id == command.operation_id:
            if (current.node_uid, current.block_offset, current.client_sequence) == (
                command.node_uid, command.block_offset, command.client_sequence,
            ):
                return snapshot
            raise ArticleReadingConflict(snapshot)
        if current.client_id == command.client_id and command.client_sequence <= current.client_sequence:
            raise ArticleReadingConflict(snapshot)
    if command.expected_revision != (current.revision if current else 0):
        raise ArticleReadingConflict(snapshot)
    updated_at = datetime.now(UTC)
    if current is not None:
        updated_at = max(updated_at, current.updated_at.replace(tzinfo=UTC) + timedelta(microseconds=1))
    cursor = ArticleReadingCursor(
        owner_id=owner_id,
        node_uid=command.node_uid,
        block_offset=command.block_offset,
        client_id=command.client_id,
        operation_id=command.operation_id,
        client_sequence=command.client_sequence,
        revision=command.expected_revision + 1,
        updated_at=updated_at,
    )
    if not store.compare_and_set(owner_id, raw, cursor.model_dump_json()):
        uow.rollback()
        raise ArticleReadingConflict(get_article_reading(store, owner_id))
    uow.commit()
    return ArticleReadingResponse(owner_id=owner_id, cursor=cursor)
