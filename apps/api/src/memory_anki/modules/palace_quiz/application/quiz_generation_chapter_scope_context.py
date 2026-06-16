"""Descendant chapter-context builders for quiz generation flows."""

from __future__ import annotations

from typing import Any

from memory_anki.infrastructure.db.models import Chapter


def flatten_descendant_chapter_contexts(
    chapter: Chapter,
    *,
    depth: int = 1,
) -> list[dict[str, Any]]:
    contexts: list[dict[str, Any]] = []
    for child in chapter.children or []:
        notes = str(child.notes or "").strip()
        contexts.append(
            {
                "chapter_id": child.id,
                "name": child.name,
                "notes": notes,
                "depth": depth,
                "match_blob": " ".join(item for item in [child.name, notes] if item).strip(),
            }
        )
        contexts.extend(flatten_descendant_chapter_contexts(child, depth=depth + 1))
    return contexts


def resolve_pdf_grouping_scope_contexts(selected_chapter: Chapter | None) -> list[dict[str, Any]]:
    if selected_chapter is None:
        return []
    return flatten_descendant_chapter_contexts(selected_chapter)


__all__ = [
    "flatten_descendant_chapter_contexts",
    "resolve_pdf_grouping_scope_contexts",
]
