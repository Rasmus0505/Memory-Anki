"""Public surface for `session`.

Stable import path for other contexts. Implementation lives in this module.

Import rule for other contexts:
    from memory_anki.modules.session.public import ...
"""

from __future__ import annotations

from . import queries

__all__ = [
    "queries",
]
