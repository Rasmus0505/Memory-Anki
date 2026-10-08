"""Classify SQLite lock contention so HTTP layers can answer retryably.

Why this module exists
----------------------
SQLite in WAL mode allows many concurrent readers but exactly ONE writer. When a
second writer arrives it waits ``busy_timeout`` and then raises
``sqlite3.OperationalError: database is locked``.

That condition is **transient and safe to retry**, but nothing in the app said so.
It surfaced through the catch-all handler as an opaque 500:

    服务器内部错误，请查看服务端日志。
    请求：POST /api/v1/review/units/<id>/sessions
    HTTP 状态：500

...while the *other* contention layer (the app-level runtime lock) already had a
proper retryable answer (``StorageBusyError`` -> 503 + ``Retry-After``). The two
locks therefore behaved completely differently to the client for the same
underlying cause, and only one of them was retryable. Measured on the owner's
machine this produced 284 ``database is locked`` failures in a single day, every
one of them reported as a 500 that the client could not distinguish from a real
bug.

This module keeps the SQL-level knowledge out of the HTTP layer: the app package
asks "is this a lock error?", it does not parse SQLite messages itself.
"""
from __future__ import annotations

from collections.abc import Iterator

# SQLite's messages for a writer that could not obtain the write lock. Kept
# lowercase for a case-insensitive match; ``database is locked`` is the one seen
# in production, the others name the same condition on a table/schema lock.
_LOCK_MESSAGES = (
    "database is locked",
    "database table is locked",
    "database schema is locked",
)

# Cap on how far we follow an exception chain. Generous for real chains, and a
# hard stop if a library ever builds a cycle.
_MAX_CAUSE_DEPTH = 10


def _iter_causes(exc: BaseException) -> Iterator[BaseException]:
    """Yield ``exc`` and its ``__cause__`` / ``__context__`` chain.

    SQLAlchemy wraps the DBAPI error, so the message we need is usually one hop
    down. ``from`` chains (``__cause__``) and implicit contexts (``__context__``)
    are both followed; seen ids prevent a cycle from looping forever.
    """
    seen: set[int] = set()
    current: BaseException | None = exc
    depth = 0
    while current is not None and depth < _MAX_CAUSE_DEPTH:
        if id(current) in seen:
            return
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__
        depth += 1


def is_sqlite_lock_error(exc: BaseException) -> bool:
    """True when ``exc`` is SQLite refusing a write because another writer holds it.

    Deliberately matches on the message rather than the exception class:
    ``sqlite3.OperationalError`` covers every SQLite operational failure (missing
    table, bad SQL, disk I/O), and treating all of those as retryable would tell
    the client to retry a request that can never succeed.
    """
    for candidate in _iter_causes(exc):
        message = str(candidate).lower()
        if any(marker in message for marker in _LOCK_MESSAGES):
            return True
    return False


__all__ = ["is_sqlite_lock_error"]
