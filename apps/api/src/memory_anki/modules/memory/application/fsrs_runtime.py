"""Shared FSRS scheduler configuration for palace nodes and vocabulary notes.

调度内核契约（review-boundary.md 已同步）：FSRS 的输出即调度真相——
本模块不再对任何评分档做间隔上/下限改写。忘记/困难的"当日重刷"由
波次层的 same_day_reinforcement 负责（队列级行为，不改 FSRS due）。
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fsrs import Scheduler
from sqlalchemy.orm import Session

DEFAULT_RETENTION = 0.9
# FSRS 官方默认（100 年）。旧值 180 天会强制高稳定卡每半年重刷。
DEFAULT_MAXIMUM_INTERVAL = 36500
DEFAULT_ENABLE_FUZZING = True
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


def _parse_bool(raw: Any, fallback: bool) -> bool:
    if raw is None:
        return fallback
    value = str(raw).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return fallback


def load_fsrs_settings(session: Session | None = None) -> dict[str, Any]:
    """Load FSRS config; cache on the SQLAlchemy session for the request lifetime."""
    if session is not None:
        cached = session.info.get("_fsrs_settings")
        if isinstance(cached, dict):
            return cached

    retention = DEFAULT_RETENTION
    maximum_interval = DEFAULT_MAXIMUM_INTERVAL
    horizon = MASTERY_HORIZON_DAYS
    learning_steps = DEFAULT_LEARNING_STEPS
    relearning_steps = DEFAULT_RELEARNING_STEPS
    enable_fuzzing = DEFAULT_ENABLE_FUZZING
    if session is not None:
        from memory_anki.infrastructure.db._tables.misc import Config

        keys = [
            "desired_retention",
            "maximum_interval",
            "mastery_horizon_days",
            "learning_steps",
            "relearning_steps",
            "enable_fuzzing",
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
        enable_fuzzing = _parse_bool(values.get("enable_fuzzing"), enable_fuzzing)
    result = {
        "desired_retention": retention,
        "maximum_interval": maximum_interval,
        "mastery_horizon_days": horizon,
        "learning_steps": learning_steps,
        "relearning_steps": relearning_steps,
        "enable_fuzzing": enable_fuzzing,
        "parameter_version": PARAMETER_VERSION,
        "parameters": None,
    }
    if session is not None:
        try:
            from memory_anki.modules.memory.application.scheduling.parameter_sets import (
                load_active_parameter_set,
            )

            active = load_active_parameter_set(session)
        except Exception:
            active = None
        if active is not None:
            result["parameter_version"] = active.set_id
            result["parameters"] = active.weights
        session.info["_fsrs_settings"] = result
    return result


def build_scheduler(
    session: Session | None = None,
    *,
    retention: float | None = None,
    maximum_interval: int | None = None,
    enable_fuzzing: bool | None = None,
) -> Scheduler:
    """Build FSRS scheduler; reuse one instance per session when defaults apply."""
    use_cache = (
        session is not None
        and retention is None
        and maximum_interval is None
        and enable_fuzzing is None
    )
    if use_cache and session is not None:
        cached = session.info.get("_fsrs_scheduler")
        if cached is not None:
            return cached

    settings = load_fsrs_settings(session)
    kwargs: dict[str, Any] = {}
    if settings.get("parameters"):
        kwargs["parameters"] = tuple(settings["parameters"])
    scheduler = Scheduler(
        desired_retention=settings["desired_retention"] if retention is None else retention,
        maximum_interval=(
            settings["maximum_interval"] if maximum_interval is None else maximum_interval
        ),
        learning_steps=settings["learning_steps"],
        relearning_steps=settings["relearning_steps"],
        enable_fuzzing=(
            settings["enable_fuzzing"] if enable_fuzzing is None else enable_fuzzing
        ),
        **kwargs,
    )
    if use_cache and session is not None:
        session.info["_fsrs_scheduler"] = scheduler
    return scheduler


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
