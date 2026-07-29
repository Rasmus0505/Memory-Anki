"""Quiz pool filtering and draw-order helpers for freestyle queues."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from .feed_config import (
    DEFAULT_QUIZ_MASTERY_BUCKETS,
    QUIZ_MASTERY_BUCKETS,
    QUIZ_SCOPE_SINGLE,
)


class _QuizLike(Protocol):
    @property
    def normalized_mastery_label(self) -> str: ...


def stable_mix(*parts: Any) -> int:
    value = 2_166_136_261
    for part in parts:
        text = str(part)
        for char in text:
            value ^= ord(char)
            value = (value * 16_777_619) & 0xFFFFFFFF
    return value


def filter_quizzes_by_mastery_buckets(
    quizzes: Sequence[_QuizLike],
    scopes: Sequence[str] | None,
) -> list[Any]:
    """Keep quizzes whose mastery label is in the multi-select mastery buckets."""
    allowed = {
        str(item).strip()
        for item in (scopes or ())
        if str(item).strip() in QUIZ_MASTERY_BUCKETS
    }
    if not allowed:
        allowed = set(DEFAULT_QUIZ_MASTERY_BUCKETS)
    return [quiz for quiz in quizzes if quiz.normalized_mastery_label in allowed]


def deterministic_shuffle(
    items: Sequence[dict[str, Any]],
    *,
    seed: int,
    salt: str = "",
) -> list[dict[str, Any]]:
    """Seed-stable shuffle for quiz draw order."""
    indexed = list(enumerate(items))
    indexed.sort(
        key=lambda pair: (
            stable_mix(seed, "shuffle", salt, pair[0], pair[1].get("id")),
            pair[0],
        )
    )
    return [item for _, item in indexed]


def order_quiz_stream_by_scope(
    quiz_by_palace: Mapping[int, Sequence[dict[str, Any]]],
    palace_ids: Sequence[int],
    *,
    quiz_scope: str,
    seed: int,
) -> list[dict[str, Any]]:
    """
    cross_palace_random: flatten then shuffle across palaces.
    single_palace_random: shuffle within each palace, then sequential by palace order.
    """
    if quiz_scope == QUIZ_SCOPE_SINGLE:
        result: list[dict[str, Any]] = []
        for palace_id in palace_ids:
            palace_cards = list(quiz_by_palace.get(palace_id, ()))
            result.extend(
                deterministic_shuffle(
                    palace_cards,
                    seed=seed,
                    salt=f"palace:{palace_id}",
                )
            )
        return result
    flat = [card for palace_id in palace_ids for card in quiz_by_palace.get(palace_id, ())]
    return deterministic_shuffle(flat, seed=seed, salt="cross")


__all__ = [
    "deterministic_shuffle",
    "filter_quizzes_by_mastery_buckets",
    "order_quiz_stream_by_scope",
    "stable_mix",
]
