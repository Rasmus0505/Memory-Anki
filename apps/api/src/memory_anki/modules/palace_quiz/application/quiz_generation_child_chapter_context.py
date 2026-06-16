"""Child-chapter grouping context builders."""

from __future__ import annotations

from memory_anki.infrastructure.db.models import Chapter


def flatten_child_chapter_contexts(chapter: Chapter) -> list[dict[str, object]]:
    contexts: list[dict[str, object]] = []
    for child in chapter.children or []:
        contexts.append(
            {
                "mini_palace_id": child.id,
                "name": child.name,
                "node_texts": [child.name, str(child.notes or "").strip()],
                "node_text_summary": "；".join(
                    [item for item in [child.name, str(child.notes or "").strip()] if item]
                ),
            }
        )
    return contexts


__all__ = ["flatten_child_chapter_contexts"]
