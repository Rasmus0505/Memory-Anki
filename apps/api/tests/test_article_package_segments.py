import json

import pytest

from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceSegment
from memory_anki.modules.content.application.article_package_segments import (
    list_article_package_segments,
    restore_article_package_segments,
    validate_article_segment_target,
)


def test_segments_remap_nodes_reuse_exact_target_and_guard_deletion(db_session):
    document = {"schemaVersion": 1, "root": {"data": {"uid": "new", "text": "Title"}}}
    palace = Palace(title="Title", editor_doc=json.dumps(document))
    db_session.add(palace)
    db_session.flush()
    descriptor = {"name": "Part 1", "color": "#ffffff", "node_uids": ["old"], "sort_order": 4}
    restore_article_package_segments(db_session, palace.id, [descriptor], {"old": "new"})
    exported = list_article_package_segments(db_session, palace.id)
    assert exported[0]["node_uids"] == ["new"]
    restore_article_package_segments(db_session, palace.id, [descriptor], {"old": "new"})
    assert db_session.query(PalaceSegment).count() == 1
    with pytest.raises(ValueError, match="removes"):
        validate_article_segment_target(db_session, palace.id, {"other"})
    with pytest.raises(ValueError, match="outside"):
        restore_article_package_segments(db_session, palace.id, [descriptor], {})
    with pytest.raises(ValueError, match="Unsupported"):
        restore_article_package_segments(db_session, palace.id, [{**descriptor, "id": 99}], {"old": "new"})
