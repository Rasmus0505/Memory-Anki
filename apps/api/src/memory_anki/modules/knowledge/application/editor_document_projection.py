from __future__ import annotations

import copy
from typing import Any

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.modules.mindmap_document.api import (
    DEFAULT_EDITOR_CONFIG,
    DEFAULT_LAYOUT,
    DEFAULT_THEME,
    NODE_ID_KEY,
    NODE_TYPE_KEY,
    NODE_UID_KEY,
    ROOT_KIND_KEY,
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
