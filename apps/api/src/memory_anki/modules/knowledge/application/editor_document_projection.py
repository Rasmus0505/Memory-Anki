from __future__ import annotations

import copy
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.modules.mindmap_document.api import (
    DEFAULT_EDITOR_CONFIG,
    DEFAULT_LAYOUT,
    DEFAULT_THEME,
    NODE_ID_KEY,
    NODE_TYPE_KEY,
    NODE_UID_KEY,
    ROOT_KIND_KEY,
    coerce_editor_int,
    deserialize_editor_payload,
    ensure_editor_dict,
    normalize_editor_doc,
    serialize_editor_payload,
    stringify_editor_value,
)


def build_subject_editor_doc(subject: Subject) -> dict[str, Any]:
    root_children = [
        _chapter_to_editor_node(chapter)
        for chapter in subject.chapters
        if chapter.parent_id is None
    ]
    return {
        "root": {
            "data": {
                "text": subject.name or "Root",
                ROOT_KIND_KEY: "subject",
                NODE_UID_KEY: "subject-root",
            },
            "children": root_children,
        },
        "theme": copy.deepcopy(DEFAULT_THEME),
        "layout": DEFAULT_LAYOUT,
        "config": copy.deepcopy(DEFAULT_EDITOR_CONFIG),
        "view": None,
        "schemaVersion": 1,
    }


def sync_subject_editor_doc_from_chapters(session: Session, subject: Subject) -> None:
    chapters = (
        session.query(Chapter)
        .filter_by(subject_id=subject.id)
        .order_by(Chapter.sort_order, Chapter.id)
        .all()
    )
    by_parent: dict[int | None, list[Chapter]] = {}
    for chapter in chapters:
        by_parent.setdefault(chapter.parent_id, []).append(chapter)

    existing_doc = deserialize_editor_payload(subject.editor_doc, None)
    existing_by_id = _index_editor_nodes_by_chapter_id(existing_doc)

    def build_nodes(parent_id: int | None) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        for chapter in by_parent.get(parent_id, []):
            existing_node = existing_by_id.get(chapter.id)
            data = ensure_editor_dict((existing_node or {}).get("data"))
            data["text"] = chapter.name or ""
            data["note"] = chapter.notes or ""
            data[NODE_ID_KEY] = chapter.id
            data[NODE_TYPE_KEY] = "chapter"
            if not stringify_editor_value(data.get(NODE_UID_KEY)).strip():
                data[NODE_UID_KEY] = f"chapter-{chapter.id}"
            nodes.append({"data": data, "children": build_nodes(chapter.id)})
        return nodes

    if isinstance(existing_doc, dict) and existing_doc:
        doc = copy.deepcopy(existing_doc)
        root = ensure_editor_dict(doc.get("root"))
        root_data = ensure_editor_dict(root.get("data"))
        root_data["text"] = subject.name or "Root"
        root_data[ROOT_KIND_KEY] = "subject"
        if not stringify_editor_value(root_data.get(NODE_UID_KEY)).strip():
            root_data[NODE_UID_KEY] = "subject-root"
        root["data"] = root_data
        root["children"] = build_nodes(None)
        doc["root"] = root
    else:
        doc = {
            "root": {
                "data": {
                    "text": subject.name or "Root",
                    ROOT_KIND_KEY: "subject",
                    NODE_UID_KEY: "subject-root",
                },
                "children": build_nodes(None),
            },
            "theme": copy.deepcopy(DEFAULT_THEME),
            "layout": DEFAULT_LAYOUT,
            "config": copy.deepcopy(DEFAULT_EDITOR_CONFIG),
            "view": None,
            "schemaVersion": 1,
        }

    subject.editor_doc = serialize_editor_payload(
        normalize_editor_doc(doc, root_text=subject.name or "Root", root_kind="subject")
    )


def _index_editor_nodes_by_chapter_id(doc: Any) -> dict[int, dict[str, Any]]:
    if not isinstance(doc, dict):
        return {}
    result: dict[int, dict[str, Any]] = {}

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        data = node.get("data")
        if isinstance(data, dict):
            chapter_id = coerce_editor_int(data.get(NODE_ID_KEY))
            if chapter_id is not None:
                result[chapter_id] = node
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                walk(child)

    walk(doc.get("root"))
    return result


def _chapter_to_editor_node(chapter: Chapter) -> dict[str, Any]:
    return {
        "data": {
            "text": chapter.name or "",
            "note": chapter.notes or "",
            NODE_UID_KEY: f"chapter-{chapter.id}",
            NODE_ID_KEY: chapter.id,
            NODE_TYPE_KEY: "chapter",
        },
        "children": [_chapter_to_editor_node(child) for child in chapter.children],
    }
