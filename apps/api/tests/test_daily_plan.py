"""每日任务层：额度、顺延、幂等、完成回写与补位。"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.memory.application.node_memory_service import rate_nodes
from memory_anki.modules.memory.application.scheduling.daily_plan import (
    ensure_daily_plan,
    get_daily_quota,
    record_plan_progress,
)


def _palace(session, count=4, title="Plan"):
    document = {
        "root": {
            "data": {"uid": "root", "text": "root"},
            "children": [
                {"data": {"uid": f"n{i}", "text": f"N{i}"}, "children": []}
                for i in range(count)
            ],
        }
    }
    palace = Palace(
        title=title, description="", difficulty=0, review_mode="review",
        editor_doc=json.dumps(document),
    )
    session.add(palace)
    session.commit()
    return palace


def _make_reviewed_overdue(session, palace, uids):
    """直接种"昨天复习过、现在逾期"的成熟卡（模拟历史卡，非当日放出）。"""
    now = datetime.now(UTC).replace(tzinfo=None)
    for uid in uids:
        row = session.query(ReviewNodeState).filter_by(
            palace_id=palace.id, node_uid=uid
        ).first()
        if row is None:
            row = ReviewNodeState(palace_id=palace.id, node_uid=uid)
            session.add(row)
        row.state = 2
        row.stability = 5.0
        row.difficulty = 5.0
        row.due_at = now - timedelta(hours=2)
        row.raw_due_at = now - timedelta(hours=2)
        row.last_review_at = now - timedelta(days=3)
        row.content_fingerprint = "fp"
        row.state_source = "manual"
        row.schedule_source = "manual"
    session.commit()


def test_only_new_card_quota_remains(db_session):
    """每日**复习**额度已删除——按卡片数截断会把整批切碎。"""
    quota = get_daily_quota(db_session)
    assert quota.new_limit == 20
    assert not hasattr(quota, "review_limit")


def test_all_due_cards_stay_pending_regardless_of_count(db_session):
    """到期就该复习：不论多少张都全部 pending，不再有顺延。"""
    palace = _palace(db_session, count=40, title="Big batch")
    _make_reviewed_overdue(db_session, palace, [f"n{i}" for i in range(40)])

    summary = ensure_daily_plan(db_session)
    db_session.commit()
    assert summary["review_pending"] == 40
    assert summary["review_done"] == 0
    assert "review_deferred" not in summary
    assert "deferred" not in summary

    # 完成若干张后，其余仍是 pending（不会被"额度"顶掉）。
    for index in range(3):
        record_plan_progress(db_session, palace_id=palace.id, node_uid=f"n{index}")
    db_session.commit()
    after = ensure_daily_plan(db_session)
    db_session.commit()
    assert after["review_done"] == 3
    assert after["review_pending"] == 37
    assert after["completed"] is False


def test_consolidate_cards_are_counted_separately(db_session):
    """巩固卡进独立的 kind，不混进宫殿复习账本。"""
    palace = _palace(db_session, count=3)
    _make_reviewed_overdue(db_session, palace, ["n0", "n1", "n2"])
    row = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="n2")
        .one()
    )
    row.schedule_source = "consolidate"
    db_session.commit()

    summary = ensure_daily_plan(db_session)
    db_session.commit()
    assert summary["review_pending"] == 2
    assert summary["consolidate_pending"] == 1
    assert summary["completed"] is False


def test_rating_marks_plan_item_done(db_session):
    palace = _palace(db_session, count=2)
    _make_reviewed_overdue(db_session, palace, ["n0", "n1"])
    summary = ensure_daily_plan(db_session)
    db_session.commit()
    assert summary["review_pending"] == 2

    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="n0",
        rating=3,
        study_session_id="s-done",
        operation_id="op-done",
        rating_scope="single",
        source_scene="practice",
    )
    after = ensure_daily_plan(db_session)
    db_session.commit()
    assert after["review_done"] == 1
    assert after["review_pending"] == 1


def test_palace_new_limit_override_caps_release(db_session):
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        upsert_palace_review_settings,
    )

    palace = _palace(db_session, count=10, title="Override")
    upsert_palace_review_settings(
        db_session, palace.id, daily_new_limit_override=3
    )
    db_session.commit()

    summary = ensure_daily_plan(db_session)
    db_session.commit()
    assert summary["new_pending"] == 3
    assert summary["backlog_new"] == 7


def test_bulk_mark_does_not_complete_plan_item(db_session):
    """批量带过不算完成今日任务（卡片仍到期未复习）。"""
    palace = _palace(db_session, count=2)
    _make_reviewed_overdue(db_session, palace, ["n0", "n1"])
    ensure_daily_plan(db_session)
    db_session.commit()

    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="n0",
        rating=3,
        study_session_id="s-bulk-plan",
        operation_id="op-bulk-plan",
        rating_scope="bulk_mark",
        source_scene="practice",
    )
    after = ensure_daily_plan(db_session)
    db_session.commit()
    assert after["review_done"] == 0
    assert after["review_pending"] == 2
