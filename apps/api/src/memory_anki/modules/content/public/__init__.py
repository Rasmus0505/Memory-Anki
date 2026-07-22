"""Public surface for `content`.

Scaffolding phase (7.22-refactor-optimize): stable import path for AI and new code.
Implementation still lives in legacy modules until W2 file moves complete.

Import rule for other contexts:
    from memory_anki.modules.content.public import ...
"""

from __future__ import annotations

from . import commands, events, projections, queries

__all__ = [
    "commands",
    "queries",
    "events",
    "projections",
]
