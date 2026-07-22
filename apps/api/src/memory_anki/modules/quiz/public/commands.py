"""Write commands for quiz.

Transitional re-exports from legacy palace_quiz.api until files move in W2.
"""

from __future__ import annotations

from memory_anki.modules.palace_quiz.api import record_attempt_event

__all__ = ["record_attempt_event"]
