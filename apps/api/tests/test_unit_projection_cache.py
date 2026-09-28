"""The per-document unit projection memo must never serve a stale document."""

from __future__ import annotations

import json

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.memory.api import resolve_unit_definitions
from memory_anki.modules.memory.application.unit_review_projection import (
    clear_unit_projection_cache,
)


def _doc(text: str) -> str:
    return json.dumps(
        {
            "root": {
                "data": {"uid": "root", "text": "缓存宫殿", "permanentSplitMark": True},
                "children": [{"data": {"uid": "node-a", "text": text}, "children": []}],
            }
        },
        ensure_ascii=False,
    )


def test_edited_document_misses_the_projection_cache(db_session):
    clear_unit_projection_cache()
    palace = Palace(title="缓存宫殿", archived=False, editor_doc=_doc("第一版"))
    db_session.add(palace)
    db_session.commit()

    _, first = resolve_unit_definitions(db_session, palace.id)
    _, repeat = resolve_unit_definitions(db_session, palace.id)
    assert [item.content_hash for item in repeat] == [item.content_hash for item in first]

    # Same shape, new text: an edit here or a Syncthing-synced doc from the other device.
    palace.editor_doc = _doc("第二版")
    db_session.commit()
    tree, edited = resolve_unit_definitions(db_session, palace.id)

    assert [item.content_hash for item in edited] != [item.content_hash for item in first]
    assert tree["nodes"]["node-a"]["text"] == "第二版"


def test_title_is_not_frozen_into_the_cached_tree(db_session):
    clear_unit_projection_cache()
    palace = Palace(title="旧标题", archived=False, editor_doc=_doc("内容"))
    db_session.add(palace)
    db_session.commit()
    resolve_unit_definitions(db_session, palace.id)

    palace.title = "新标题"
    db_session.commit()
    tree, _ = resolve_unit_definitions(db_session, palace.id)

    assert tree["title"] == "新标题"
    assert tree["palace_id"] == palace.id


def test_callers_cannot_corrupt_the_cached_definitions(db_session):
    clear_unit_projection_cache()
    palace = Palace(title="缓存宫殿", archived=False, editor_doc=_doc("内容"))
    db_session.add(palace)
    db_session.commit()

    _, definitions = resolve_unit_definitions(db_session, palace.id)
    count = len(definitions)
    definitions.clear()
    _, again = resolve_unit_definitions(db_session, palace.id)

    assert len(again) == count > 0
