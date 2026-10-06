"""Subject shelf stays a read while another writer holds the storage lock."""

from __future__ import annotations

import json
import threading
import time

from memory_anki.core.runtime_storage_lock import storage_write_lock
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.content.presentation import router as palace_router
from memory_anki.modules.memory.application.unit_review_projection import (
    reconcile_palace_units,
)
from memory_anki.modules.memory.application.unit_review_summary import (
    project_palace_review_summaries,
)


def _marked_editor_doc(child_text: str) -> str:
    return json.dumps(
        {
            "root": {
                "data": {
                    "uid": "root",
                    "text": "root",
                    "permanentSplitMark": True,
                },
                "children": [
                    {
                        "data": {"uid": "n1", "text": child_text},
                        "children": [],
                    }
                ],
            }
        },
        ensure_ascii=False,
    )


def test_subject_shelf_reads_stored_due_without_taking_storage_lock(make_client, session_factory):
    client = make_client(palace_router)
    with session_factory() as session:
        palace = Palace(title="shelf-lock", editor_doc=_marked_editor_doc("original"))
        session.add(palace)
        session.flush()
        reconcile_palace_units(session, palace.id)
        palace.editor_doc = _marked_editor_doc("edited-without-reconcile")
        session.commit()
        palace_id = palace.id
        stored = session.query(ReviewUnitState).filter_by(palace_id=palace_id, active=True).one()
        stored_revision = stored.revision
        stored_content_hash = stored.content_hash

    started = threading.Event()
    release = threading.Event()

    def hold_lock() -> None:
        with storage_write_lock():
            started.set()
            assert release.wait(timeout=5)

    holder = threading.Thread(target=hold_lock)
    holder.start()
    assert started.wait(timeout=2)
    started_at = time.perf_counter()
    try:
        response = client.get("/api/v1/palaces/subjects")
    finally:
        release.set()
        holder.join(timeout=2)
    elapsed = time.perf_counter() - started_at

    assert response.status_code == 200
    assert elapsed < 2
    body = response.json()
    assert body["items"][0]["palace_count"] == 1
    assert body["items"][0]["has_due_review"] is True
    assert body["items"][0]["due_now_count"] == 1

    with session_factory() as session:
        palace = session.get(Palace, palace_id)
        assert palace is not None
        stored = session.query(ReviewUnitState).filter_by(palace_id=palace_id, active=True).one()
        assert stored.revision == stored_revision
        assert stored.content_hash == stored_content_hash
        project_palace_review_summaries(session, [palace])
        session.refresh(stored)
        assert stored.revision == stored_revision
        assert stored.content_hash == stored_content_hash
        assert not session.new
        assert not session.dirty
