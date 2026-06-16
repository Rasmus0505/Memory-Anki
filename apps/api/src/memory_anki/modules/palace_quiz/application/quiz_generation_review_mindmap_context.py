"""Review-mindmap context extraction and related palace summaries."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace

from .quiz_generation_chaptering import (
    extract_first_multi_node_summary,
    node_children,
    node_text,
)


def compact_mindmap_for_prompt(editor_doc: Any, *, max_nodes: int = 160) -> dict[str, Any]:
    root = (editor_doc or {}).get("root") if isinstance(editor_doc, dict) else None
    if not isinstance(root, dict):
        from memory_anki.modules.mindmap.application.editor_state_documents import (
            deserialize_editor_payload,
        )

        doc = deserialize_editor_payload(editor_doc, {})
        root = doc.get("root") if isinstance(doc, dict) else None
    count = 0

    def walk(node: Any, depth: int = 0) -> dict[str, Any] | None:
        nonlocal count
        if not isinstance(node, dict) or count >= max_nodes:
            return None
        text = node_text(node)
        children = node_children(node)
        count += 1
        return {
            "text": text,
            "children": [
                child_payload
                for child in children
                if (child_payload := walk(child, depth + 1)) is not None
            ],
        }

    compact = walk(root)
    return compact or {"text": "", "children": []}


def build_related_palace_summaries(
    session: Session,
    *,
    current_palace_id: int,
    related_palace_ids: Any,
) -> list[dict[str, Any]]:
    if not isinstance(related_palace_ids, list):
        return []
    normalized_ids: list[int] = []
    for raw_id in related_palace_ids:
        try:
            palace_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if palace_id > 0 and palace_id != current_palace_id and palace_id not in normalized_ids:
            normalized_ids.append(palace_id)
    if not normalized_ids:
        return []
    rows = (
        session.query(Palace)
        .filter(Palace.id.in_(normalized_ids))
        .order_by(Palace.id.asc())
        .all()
    )
    summaries: list[dict[str, Any]] = []
    for palace in rows:
        first_multi_nodes = extract_first_multi_node_summary(palace.editor_doc)
        if not first_multi_nodes:
            continue
        subject = None
        primary_chapter = getattr(palace, "primary_chapter", None)
        if primary_chapter is not None and getattr(primary_chapter, "subject", None) is not None:
            subject = {
                "id": primary_chapter.subject.id,
                "name": primary_chapter.subject.name,
            }
        summaries.append(
            {
                "palace_id": palace.id,
                "title": palace.title,
                "subject": subject,
                "first_multi_nodes": first_multi_nodes,
            }
        )
    return summaries


__all__ = [
    "build_related_palace_summaries",
    "compact_mindmap_for_prompt",
]
