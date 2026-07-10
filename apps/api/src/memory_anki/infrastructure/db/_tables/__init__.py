"""Domain-split ORM table registry.

Importing this package imports every domain table module so that all tables
register against the shared ``Base.metadata`` before ``init_db`` runs. The
public entry point remains ``memory_anki.infrastructure.db.models``, which
re-exports every symbol below for backwards compatibility.
"""

from . import english, english_reading, knowledge, mindmap, misc, palaces, quiz_generation  # noqa: F401
from ._base import Base, engine, get_session, init_db

__all__ = ["Base", "engine", "get_session", "init_db"]
