"""Regression guards for the storage-lock starvation that froze rating.

Background
----------
``list_due_units`` used to repair a lagging palace *inside the read request*.
That repair is a write, so SQLAlchemy's ``before_flush`` hook took the single
global runtime storage lock. A "show me my queue" GET could therefore hold the
one lock every rating and autosave needs; requests that waited past the wait
budget failed 503 and clients retried, adding contention. On the owner's machine
that produced 116 such 503s in an hour and a rating bar that looked dead.

These tests pin the two invariants that stop it coming back:

  1. A read-only caller must NOT write. With ``allow_reconcile=False`` a lagging
     palace is deferred to the background queue and no flush/commit happens.
  2. Deferred work must actually converge, so freshness is not traded away.
"""

from __future__ import annotations

import json
from datetime import date

import pytest
from sqlalchemy import event

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.memory.api import list_due_units, reconcile_palace_units
from memory_anki.modules.memory.application import unit_reconcile_scheduler as scheduler


def _doc(*, text: str = "节点 A", mark: bool = True) -> str:
    """Same root/child shape the real mindmap parser expects."""
    root = {
        "uid": "root",
        "text": "锁饥饿回归宫殿",
        "memoryAnkiRootKind": "palace",
    }
    if mark:
        root["permanentSplitMark"] = True
    return json.dumps(
        {
            "root": {
                "data": root,
                "children": [
                    {"data": {"uid": "node-a", "text": text}, "children": []},
                ],
            }
        },
        ensure_ascii=False,
    )


def _seed(session, *, stage_index: int = 3) -> ReviewUnitState:
    """Create one real, due review unit through the production reconcile path."""
    palace = Palace(title="锁饥饿回归宫殿", archived=False, editor_doc=_doc())
    session.add(palace)
    session.commit()
    result = reconcile_palace_units(session, palace.id)
    session.commit()
    assert result["unit_count"] == 1
    unit = session.query(ReviewUnitState).filter_by(palace_id=palace.id, active=True).one()
    unit.stage_index = stage_index
    unit.has_passed = True
    unit.due_date = date.today()
    unit.revision += 1
    session.commit()
    return unit


@pytest.fixture(autouse=True)
def _clean_scheduler():
    scheduler.clear_pending()
    yield
    scheduler.clear_pending()


def test_read_only_list_due_units_does_not_write(db_session):
    """The starvation fix itself: a lagging palace must not be repaired in-request."""
    unit = _seed(db_session)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None

    # Advance the document without reconciling: the stored hash now lags.
    palace.editor_doc = _doc(text="节点 A 读路径不得写库")
    db_session.commit()
    db_session.expire_all()
    hash_before = db_session.get(ReviewUnitState, unit.id).content_hash  # type: ignore[union-attr]

    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lstrip().split(None, 1)[0].upper())

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", _record)
    try:
        list_due_units(db_session, allow_reconcile=False)
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    # No UPDATE/INSERT went out: the read path stayed read-only.
    writes = [s for s in statements if s in {"UPDATE", "INSERT", "DELETE"}]
    assert writes == [], f"read-only path issued writes: {writes}"

    # And the stale palace was handed to the background reconciler instead.
    assert scheduler.pending_palace_ids() == [palace.id]

    db_session.expire_all()
    still_stale = db_session.get(ReviewUnitState, unit.id)
    assert still_stale is not None
    assert still_stale.content_hash == hash_before, "read path must not have healed it"


def test_write_path_still_reconciles_inline(db_session):
    """Freestyle/session paths keep the healing behaviour they depend on."""
    unit = _seed(db_session)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None

    palace.editor_doc = _doc(text="节点 A 写路径仍就地重建")
    db_session.commit()
    db_session.expire_all()
    hash_before = db_session.get(ReviewUnitState, unit.id).content_hash  # type: ignore[union-attr]

    list_due_units(db_session)  # default: allow_reconcile=True
    db_session.commit()

    db_session.expire_all()
    healed = db_session.get(ReviewUnitState, unit.id)
    assert healed is not None
    assert healed.content_hash != hash_before, "write path must still reconcile inline"
    assert scheduler.pending_palace_ids() == [], "write path must not defer"


def test_scheduled_reconcile_converges_so_freshness_is_kept(db_session, session_factory):
    """Deferral must not be a silent way to stay stale forever."""
    unit = _seed(db_session)
    palace = db_session.get(Palace, unit.palace_id)
    assert palace is not None

    palace.editor_doc = _doc(text="节点 A 后台收敛")
    db_session.commit()
    db_session.expire_all()
    stale_hash = db_session.get(ReviewUnitState, unit.id).content_hash  # type: ignore[union-attr]

    list_due_units(db_session, allow_reconcile=False)
    assert scheduler.has_pending() is True

    result = scheduler.drain_once(limit=8, session_factory=session_factory)
    assert result["reconciled"] >= 1
    assert scheduler.has_pending() is False

    db_session.expire_all()
    converged = db_session.get(ReviewUnitState, unit.id)
    assert converged is not None
    assert converged.content_hash != stale_hash, "background drain must heal the palace"


def test_schedule_reconcile_is_idempotent_and_bounded():
    """Queueing the same palace twice must not double the work."""
    assert scheduler.schedule_reconcile([7, 8]) == 2
    assert scheduler.schedule_reconcile([8, 9]) == 1
    assert scheduler.pending_palace_ids() == [7, 8, 9]

    scheduler.clear_pending()
    assert scheduler.has_pending() is False


def test_drain_once_is_a_noop_when_queue_is_empty():
    result = scheduler.drain_once()
    assert result == {"reconciled": 0, "failed": 0, "skipped": 0}
