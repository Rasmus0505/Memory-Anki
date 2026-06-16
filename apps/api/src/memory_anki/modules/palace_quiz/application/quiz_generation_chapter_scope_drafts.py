"""Draft mutation helpers for chapter-scoped quiz generation."""

from __future__ import annotations

from typing import Any


def apply_source_chapter_to_drafts(
    drafts: list[dict[str, Any]],
    *,
    chapter_id: int | None,
) -> None:
    if chapter_id is None:
        return
    for draft in drafts:
        draft["source_chapter_id"] = chapter_id


__all__ = ["apply_source_chapter_to_drafts"]
