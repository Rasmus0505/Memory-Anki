"""Exam star weights. Framework-free.

Resolution order for a palace (first hit wins):
1. The palace's own ``exam_stars`` (written manually on the shelf or by local AI).
2. The nearest chapter up the palace's primary-chapter chain with ``exam_stars``.
3. Derived from its published questions (source ``derived``):
   score = question_count + 2 * subjective_count
   (a subjective ``short_answer`` question weighs three times an objective one)
   score >= 12 -> 3 stars, score >= 5 -> 2 stars, otherwise 1 star.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

MIN_STARS = 1
MAX_STARS = 3
SOURCE_MANUAL = "manual"
SOURCE_AI = "ai"
SOURCE_CHAPTER = "chapter"
SOURCE_DERIVED = "derived"
WRITABLE_SOURCES = frozenset({SOURCE_MANUAL, SOURCE_AI})
SUBJECTIVE_QUESTION_TYPE = "short_answer"
SUBJECTIVE_EXTRA_WEIGHT = 2
THREE_STAR_SCORE = 12
TWO_STAR_SCORE = 5


@dataclass(frozen=True)
class ResolvedStars:
    stars: int
    source: str
    # Chapter that supplied the stars when ``source == "chapter"``.
    chapter_id: int | None = None


def clamp_stars(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        stars = int(value)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return None
    if stars <= 0:
        return None
    return max(MIN_STARS, min(MAX_STARS, stars))


def normalize_source(value: object) -> str:
    source = str(value or "").strip().lower()
    return source if source in WRITABLE_SOURCES else SOURCE_MANUAL


def derive_stars(question_count: int, subjective_count: int) -> int:
    score = max(0, int(question_count)) + SUBJECTIVE_EXTRA_WEIGHT * max(0, int(subjective_count))
    if score >= THREE_STAR_SCORE:
        return 3
    if score >= TWO_STAR_SCORE:
        return 2
    return 1


def resolve_palace_stars(
    *,
    palace_stars: int | None,
    palace_source: str | None,
    chapter_chain: Sequence[tuple[int, int | None]],
    question_count: int,
    subjective_count: int,
) -> ResolvedStars:
    """``chapter_chain`` runs from the palace's primary chapter up to the root."""
    own = clamp_stars(palace_stars)
    if own is not None:
        return ResolvedStars(own, normalize_source(palace_source))
    for chapter_id, chapter_stars in chapter_chain:
        inherited = clamp_stars(chapter_stars)
        if inherited is not None:
            return ResolvedStars(inherited, SOURCE_CHAPTER, chapter_id)
    return ResolvedStars(derive_stars(question_count, subjective_count), SOURCE_DERIVED)


def chapter_chain(
    start_chapter_id: int | None,
    parents: Mapping[int, int | None],
    stars: Mapping[int, int | None],
) -> list[tuple[int, int | None]]:
    chain: list[tuple[int, int | None]] = []
    seen: set[int] = set()
    current = start_chapter_id
    while current is not None and current not in seen:
        seen.add(current)
        chain.append((current, stars.get(current)))
        current = parents.get(current)
    return chain


def star_weight(stars: int) -> float:
    return {1: 1.0, 2: 1.8, 3: 3.0}.get(int(stars), 1.0)
