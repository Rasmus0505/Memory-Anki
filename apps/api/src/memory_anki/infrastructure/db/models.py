"""Database compatibility facade.

New code should import ORM tables from ``memory_anki.infrastructure.db._tables``.
This module keeps the historical session/engine entry points available while
importing the table registry for ``Base.metadata`` side effects.
"""

from memory_anki.infrastructure.db import _tables  # noqa: F401  (registers all tables)
from memory_anki.infrastructure.db._tables._base import Base, engine, get_session, init_db

__all__ = [
    "Base",
    "engine",
    "get_session",
    "init_db",
]
