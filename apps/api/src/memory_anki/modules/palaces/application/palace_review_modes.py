from __future__ import annotations

from memory_anki.infrastructure.db.models import Palace

MINI_REVIEW_MODE_INDEPENDENT = "independent"
MINI_REVIEW_MODE_MINI_ONLY = "mini_only"


def resolve_palace_mini_review_mode(palace: Palace) -> str:
    value = str(
        getattr(palace, "mini_review_mode", MINI_REVIEW_MODE_INDEPENDENT) or MINI_REVIEW_MODE_INDEPENDENT
    )
    if value == MINI_REVIEW_MODE_MINI_ONLY:
        return MINI_REVIEW_MODE_MINI_ONLY
    return MINI_REVIEW_MODE_INDEPENDENT


def palace_uses_mini_only_review(palace: Palace) -> bool:
    return resolve_palace_mini_review_mode(palace) == MINI_REVIEW_MODE_MINI_ONLY and bool(
        list(getattr(palace, "mini_palaces", []) or [])
    )


__all__ = [
    "MINI_REVIEW_MODE_INDEPENDENT",
    "MINI_REVIEW_MODE_MINI_ONLY",
    "palace_uses_mini_only_review",
    "resolve_palace_mini_review_mode",
]
