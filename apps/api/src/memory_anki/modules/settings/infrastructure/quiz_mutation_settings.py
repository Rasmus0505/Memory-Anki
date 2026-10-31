"""Read the configurable muscle-memory auto-mark thresholds.

The thresholds live in the same ``config`` key/value table as the other
runtime settings, so both devices read the same values from the synced data
folder. Values are clamped to safe ranges; malformed values fall back to the
defaults in ``memory_anki.core.config.DEFAULTS``.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from memory_anki.core.config import DEFAULTS
from memory_anki.infrastructure.db._tables.misc import Config

MIN_ATTEMPTS_KEY = "quiz_mutation_min_attempts"
MIN_CONSECUTIVE_KEY = "quiz_mutation_min_consecutive_correct"
MAX_DURATION_KEY = "quiz_mutation_max_duration_ms"

_DEFAULT_MIN_ATTEMPTS = 3
_DEFAULT_MIN_CONSECUTIVE = 3
_DEFAULT_MAX_DURATION_MS = 5_000


@dataclass(frozen=True)
class QuizMutationSettings:
    min_attempts: int
    min_consecutive_correct: int
    max_duration_ms: int


def _read_int(session: Session, key: str, default: int, minimum: int, maximum: int) -> int:
    row = session.query(Config).filter(Config.key == key).first()
    raw = row.value if row is not None and row.value else DEFAULTS.get(key, "")
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def read_quiz_mutation_settings(session: Session) -> QuizMutationSettings:
    return QuizMutationSettings(
        min_attempts=_read_int(
            session, MIN_ATTEMPTS_KEY, _DEFAULT_MIN_ATTEMPTS, 1, 99
        ),
        min_consecutive_correct=_read_int(
            session, MIN_CONSECUTIVE_KEY, _DEFAULT_MIN_CONSECUTIVE, 1, 99
        ),
        max_duration_ms=_read_int(
            session, MAX_DURATION_KEY, _DEFAULT_MAX_DURATION_MS, 500, 60_000
        ),
    )


__all__ = [
    "MAX_DURATION_KEY",
    "MIN_ATTEMPTS_KEY",
    "MIN_CONSECUTIVE_KEY",
    "QuizMutationSettings",
    "read_quiz_mutation_settings",
]
