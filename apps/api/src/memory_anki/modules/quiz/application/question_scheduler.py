"""Question-owned first-learning schedule. Framework-free.

Quiz ratings in palace / overlay / node-bound practice always write from a
first-learning baseline: 忘记/困难 stay unpassed and due today; 记得 starts the
one-day stage; 轻松 starts the three-day stage. This does not touch palace
review-unit scheduling.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

INTERVAL_DAYS: tuple[int, ...] = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)
RATING_LABELS: dict[int, str] = {1: "忘记", 2: "困难", 3: "记得", 4: "轻松"}
VALID_RATINGS = frozenset(RATING_LABELS)
DUE_KIND_DUE = "due"
DUE_KIND_OTHER = "other"
OVERLAY_QUESTION_RANGE_DUE = "due"
OVERLAY_QUESTION_RANGE_ALL = "all"
OVERLAY_QUESTION_RANGES = {OVERLAY_QUESTION_RANGE_DUE, OVERLAY_QUESTION_RANGE_ALL}


@dataclass(frozen=True)
class QuestionScheduleResult:
    stage: int
    due_on: date
    passed: bool
    rating: int


def normalize_rating(value: int | str) -> int:
    if isinstance(value, str):
        labels = {label: rating for rating, label in RATING_LABELS.items()}
        if value in labels:
            return labels[value]
    try:
        rating = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("rating must be 1-4 or 忘记/困难/记得/轻松") from exc
    if rating not in VALID_RATINGS:
        raise ValueError("rating must be 1-4 or 忘记/困难/记得/轻松")
    return rating


def apply_first_learning_rating(
    rating: int | str,
    *,
    today: date | None = None,
) -> QuestionScheduleResult:
    current = today or date.today()
    normalized = normalize_rating(rating)
    if normalized in (1, 2):
        return QuestionScheduleResult(stage=0, due_on=current, passed=False, rating=normalized)
    stage = 1 if normalized == 3 else 2
    return QuestionScheduleResult(
        stage=stage,
        due_on=current + timedelta(days=INTERVAL_DAYS[stage]),
        passed=True,
        rating=normalized,
    )


def parse_due_on(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def schedule_due_kind(due_on: date | None, *, today: date | None = None) -> str:
    current = today or date.today()
    if due_on is not None and due_on <= current:
        return DUE_KIND_DUE
    return DUE_KIND_OTHER


def question_is_due(payload: Any, *, today: date | None = None) -> bool:
    if not isinstance(payload, dict):
        return False
    return schedule_due_kind(parse_due_on(payload.get("schedule_due_on")), today=today) == DUE_KIND_DUE


def normalize_overlay_question_range(value: Any) -> str:
    key = str(value or "").strip()
    if key in OVERLAY_QUESTION_RANGES:
        return key
    return OVERLAY_QUESTION_RANGE_ALL
