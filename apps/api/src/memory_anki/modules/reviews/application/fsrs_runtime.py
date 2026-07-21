"""Shared FSRS scheduler configuration for palace nodes and vocabulary notes."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fsrs import Scheduler
from sqlalchemy.orm import Session

DEFAULT_RETENTION = 0.9
DEFAULT_MAXIMUM_INTERVAL = 180
MASTERY_HORIZON_DAYS = 60
SCHEDULER_VERSION = "fsrs-6.3.1"
PARAMETER_VERSION = "default"
DEFAULT_LEARNING_STEPS: tuple[timedelta, ...] = (
    timedelta(minutes=10),
    timedelta(hours=1),
)
DEFAULT_RELEARNING_STEPS: tuple[timedelta, ...] = (
    timedelta(minutes=10),
    timedelta(hours=1),
)
# 忘记 / 困难 must re-enter the queue soon. Multi-day intervals only after 记得/轻松.
# (py-fsrs Hard on mature Review cards can otherwise jump ~10 days.)
WEAK_AGAIN_MAX_INTERVAL = timedelta(minutes=10)
WEAK_HARD_MAX_INTERVAL = timedelta(minutes=30)
# Learning / relearning steps (default 10m, 1h) would otherwise put 记得 back within
# an hour — product policy is multi-day only for Good/Easy (see review-boundary.md).
STRONG_GOOD_MIN_INTERVAL = timedelta(days=1)
STRONG_EASY_MIN_INTERVAL = timedelta(days=3)
# When freezing a formal session, also pull in cards that become due during typical
# short weak-rating windows so they are not left outside the frozen scope.
FORMAL_ENTRY_NEAR_DUE_LOOKAHEAD = timedelta(hours=1)

RATING_LABELS = {1: "忘记", 2: "困难", 3: "记得", 4: "轻松"}
VALID_RATINGS = frozenset(RATING_LABELS)
RATING_FROM_RESULT = {
    "forgot": 1,
    "again": 1,
    "hard": 2,
    "good": 3,
    "easy": 4,
    "忘记": 1,
    "困难": 2,
    "记得": 3,
    "轻松": 4,
}


def _parse_step_token(raw: str) -> timedelta | None:
    value = str(raw or "").strip().lower()
    if not value:
        return None
    if value.endswith("m") and value[:-1].isdigit():
        return timedelta(minutes=max(1, int(value[:-1])))
    if value.endswith("h") and value[:-1].isdigit():
        return timedelta(hours=max(1, int(value[:-1])))
    if value.endswith("d") and value[:-1].isdigit():
        return timedelta(days=max(1, int(value[:-1])))
    if value.isdigit():
        return timedelta(minutes=max(1, int(value)))
    return None


def _parse_steps(raw: str | None, fallback: tuple[timedelta, ...]) -> tuple[timedelta, ...]:
    if not raw:
        return fallback
    steps = tuple(
        step
        for token in str(raw).split(",")
        if (step := _parse_step_token(token)) is not None
    )
    return steps or fallback


def load_fsrs_settings(session: Session | None = None) -> dict[str, Any]:
    retention = DEFAULT_RETENTION
    maximum_interval = DEFAULT_MAXIMUM_INTERVAL
    horizon = MASTERY_HORIZON_DAYS
    learning_steps = DEFAULT_LEARNING_STEPS
    relearning_steps = DEFAULT_RELEARNING_STEPS
    if session is not None:
        from memory_anki.infrastructure.db._tables.misc import Config

        keys = [
            "desired_retention",
            "maximum_interval",
            "mastery_horizon_days",
            "learning_steps",
            "relearning_steps",
        ]
        values = {
            row.key: row.value
            for row in session.query(Config).filter(Config.key.in_(keys)).all()
        }
        try:
            retention = float(values.get("desired_retention", retention))
        except (TypeError, ValueError):
            pass
        try:
            maximum_interval = int(values.get("maximum_interval", maximum_interval))
        except (TypeError, ValueError):
            pass
        try:
            horizon = int(values.get("mastery_horizon_days", horizon))
        except (TypeError, ValueError):
            pass
        learning_steps = _parse_steps(values.get("learning_steps"), learning_steps)
        relearning_steps = _parse_steps(values.get("relearning_steps"), relearning_steps)
    return {
        "desired_retention": retention,
        "maximum_interval": maximum_interval,
        "mastery_horizon_days": horizon,
        "learning_steps": learning_steps,
        "relearning_steps": relearning_steps,
    }


def build_scheduler(
    session: Session | None = None,
    *,
    retention: float | None = None,
    maximum_interval: int | None = None,
) -> Scheduler:
    settings = load_fsrs_settings(session)
    return Scheduler(
        desired_retention=settings["desired_retention"] if retention is None else retention,
        maximum_interval=(
            settings["maximum_interval"] if maximum_interval is None else maximum_interval
        ),
        learning_steps=settings["learning_steps"],
        relearning_steps=settings["relearning_steps"],
        enable_fuzzing=False,
    )


def _review_now_aware(now: Any | None = None) -> Any:
    from datetime import datetime, timezone

    review_now = now or datetime.now(timezone.utc)
    if getattr(review_now, "tzinfo", None) is None:
        review_now = review_now.replace(tzinfo=timezone.utc)
    return review_now


def _due_aware(due: Any) -> Any | None:
    from datetime import timezone

    if due is None:
        return None
    return due if getattr(due, "tzinfo", None) is not None else due.replace(tzinfo=timezone.utc)


def cap_weak_rating_due(card: Any, rating: int, *, now: Any | None = None) -> Any:
    """Keep 忘记/困难 inside a short same-day re-study window.

    Multi-day FSRS intervals are allowed only after 记得 (3) / 轻松 (4). Without
    this cap, Hard on a mature Review card can schedule ~10 days out even though
    the learner still needs the card soon.
    """
    if rating not in (1, 2):
        return card
    review_now = _review_now_aware(now)
    max_interval = WEAK_AGAIN_MAX_INTERVAL if rating == 1 else WEAK_HARD_MAX_INTERVAL
    max_due = review_now + max_interval
    due_aware = _due_aware(getattr(card, "due", None))
    if due_aware is None:
        return card
    if due_aware > max_due:
        card.due = max_due
    return card


def ensure_strong_rating_due(card: Any, rating: int, *, now: Any | None = None) -> Any:
    """Floor 记得/轻松 so learning/relearning steps cannot reschedule same-day.

    py-fsrs with default steps (10m, 1h) schedules the first Good on a New or
    Relearning card for ~1 hour later. Formal palace review treats 记得 as
    "remembered — multi-day interval", matching the weak-rating policy docs.
    When FSRS still leaves the card in Learning/Relearning after Good/Easy,
    promote to Review so the next rating uses the review path, not short steps.
    """
    if rating not in (3, 4):
        return card
    from fsrs import State

    review_now = _review_now_aware(now)
    min_interval = STRONG_EASY_MIN_INTERVAL if rating == 4 else STRONG_GOOD_MIN_INTERVAL
    min_due = review_now + min_interval
    due_aware = _due_aware(getattr(card, "due", None))
    if due_aware is None or due_aware < min_due:
        card.due = min_due

    state = getattr(card, "state", None)
    state_value = int(state) if state is not None else None
    if state_value in {int(State.Learning), int(State.Relearning)}:
        card.state = State.Review
        card.step = None
    return card


def normalize_rating(value: int | str) -> int:
    if isinstance(value, int):
        if value not in VALID_RATINGS:
            raise ValueError("rating must be between 1 and 4")
        return value
    key = str(value or "").strip().lower()
    if key.isdigit():
        return normalize_rating(int(key))
    rating = RATING_FROM_RESULT.get(key)
    if rating is None:
        raise ValueError("rating must be 1-4 or forgot/hard/good/easy")
    return rating
