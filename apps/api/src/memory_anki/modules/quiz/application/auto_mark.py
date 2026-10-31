"""Apply an answer to the question-level muscle-memory counters.

The thresholds are runtime settings (defaults 3 attempts / 3 consecutive
correct / 5000 ms). The caller decides whether the answer is canonical: the
freestyle flow records the choice attempt with stats disabled and lets its
history record apply the counters, so one user answer never counts twice.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.modules.settings.api import read_quiz_mutation_settings


@dataclass(frozen=True)
class AttemptEffectResult:
    auto_marked: bool
    auto_mark_threshold_ms: int


def apply_attempt_effect(
    session: Session,
    question: Any,
    *,
    is_correct: bool | None,
    duration_ms: int | None,
) -> AttemptEffectResult:
    settings = read_quiz_mutation_settings(session)
    now = utc_now_naive()

    question.mutation_attempt_count = int(
        getattr(question, "mutation_attempt_count", 0) or 0
    ) + 1
    if duration_ms is not None:
        question.last_answer_duration_ms = max(0, int(duration_ms))
    if is_correct is True:
        question.consecutive_correct_count = int(
            getattr(question, "consecutive_correct_count", 0) or 0
        ) + 1
    elif is_correct is False:
        question.consecutive_correct_count = 0

    auto_marked = False
    if (
        not bool(getattr(question, "needs_mutation", False))
        and is_correct is True
        and duration_ms is not None
        and int(duration_ms) < settings.max_duration_ms
        and int(getattr(question, "mutation_attempt_count", 0) or 0)
        >= settings.min_attempts
        and int(getattr(question, "consecutive_correct_count", 0) or 0)
        >= settings.min_consecutive_correct
    ):
        question.needs_mutation = True
        question.mutation_marked_at = now
        auto_marked = True
    question.updated_at = now
    return AttemptEffectResult(
        auto_marked=auto_marked,
        auto_mark_threshold_ms=settings.max_duration_ms,
    )


__all__ = ["AttemptEffectResult", "apply_attempt_effect"]
