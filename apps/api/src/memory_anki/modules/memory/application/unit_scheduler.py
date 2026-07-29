"""Fixed, explainable scheduling policy for permanent-mark review units."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

# Stage 0 is the initial-learning state. A successful first "remember" moves
# to stage 1, whose one-day interval guarantees a review on the next day.
INTERVAL_DAYS: tuple[int, ...] = (0, 1, 3, 7, 14, 30, 60, 120, 240, 365)
RATING_LABELS: dict[int, str] = {1: "忘记", 2: "困难", 3: "记得", 4: "轻松"}
VALID_RATINGS = frozenset(RATING_LABELS)
RETRY_AFTER_CARDS = 3


@dataclass(frozen=True)
class UnitScheduleResult:
    stage_index: int
    due_date: date
    passed: bool
    retry_after_cards: int


def normalize_rating(value: int | str) -> int:
    if isinstance(value, str):
        labels = {label: rating for rating, label in RATING_LABELS.items()}
        if value in labels:
            return labels[value]
    rating = int(value)
    if rating not in VALID_RATINGS:
        raise ValueError("rating must be 1-4 or 忘记/困难/记得/轻松")
    return rating


def clamp_stage(stage_index: int) -> int:
    return max(0, min(int(stage_index), len(INTERVAL_DAYS) - 1))


def interval_days(stage_index: int) -> int:
    return INTERVAL_DAYS[clamp_stage(stage_index)]


def rate_unit(
    *,
    stage_index: int,
    has_passed: bool,
    rating: int,
    had_failure_in_encounter: bool,
    today: date | None = None,
) -> UnitScheduleResult:
    current_day = today or date.today()
    current_stage = clamp_stage(stage_index)
    normalized = normalize_rating(rating)

    if normalized == 1:
        return UnitScheduleResult(0, current_day, False, RETRY_AFTER_CARDS)
    if normalized == 2:
        penalized = max(0, current_stage - 1) if has_passed else 0
        return UnitScheduleResult(penalized, current_day, False, RETRY_AFTER_CARDS)

    if had_failure_in_encounter:
        if not has_passed:
            passed_stage = 1 if normalized == 3 else 2
        else:
            passed_stage = current_stage if normalized == 3 else clamp_stage(current_stage + 1)
    elif not has_passed:
        passed_stage = 1 if normalized == 3 else 2
    else:
        passed_stage = clamp_stage(current_stage + (1 if normalized == 3 else 2))
    return UnitScheduleResult(
        passed_stage,
        current_day + timedelta(days=interval_days(passed_stage)),
        True,
        0,
    )


def stage_from_legacy_interval_days(value: float | int | None) -> int:
    if value is None:
        return 0
    days = max(0.0, float(value))
    selected = 0
    for index, interval in enumerate(INTERVAL_DAYS):
        if interval > days:
            break
        selected = index
    return selected


__all__ = [
    "INTERVAL_DAYS",
    "RATING_LABELS",
    "RETRY_AFTER_CARDS",
    "VALID_RATINGS",
    "UnitScheduleResult",
    "interval_days",
    "normalize_rating",
    "rate_unit",
    "stage_from_legacy_interval_days",
]
