"""历史修复重建：污染剔除、backlog 回收、回滚位相等。"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.memory.application.scheduling.history_rebuild import (
    execute_rebuild,
    preview_rebuild,
    rollback_rebuild,
)


def _palace(session):
    palace = Palace(
        title="Rebuild", description="", difficulty=0, review_mode="review",
        editor_doc=json.dumps(
            {"root": {"data": {"uid": "root", "text": "r"}, "children": [
                {"data": {"uid": "real", "text": "Real"}, "children": []},
                {"data": {"uid": "polluted", "text": "Polluted"}, "children": []},
            ]}}
        ),
    )
    session.add(palace)
    session.commit()
    return palace


def _event(session, palace_id, uid, *, rating, origin, offset_days, suffix=""):
    session.add(
        MindMapRecallEvent(
            id=f"rb-{uid}-{origin}-{offset_days}{suffix}",
            study_session_id="s-rb",
            palace_id=palace_id,
            node_uid=uid,
            source_scene="formal_review",
            recall_round="first",
            rating=rating,
            rating_source="manual",
            rating_scope="single",
            evidence_origin=origin,
            hint_count=0,
            retry_count=0,
            occurred_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=offset_days),
        )
    )


def _inflated_row(session, palace_id, uid):
    now = datetime.now(UTC).replace(tzinfo=None)
    row = ReviewNodeState(
        palace_id=palace_id,
        node_uid=uid,
        state=2,
        stability=90.0,  # 被批量继承吹高的稳定度
        difficulty=3.0,
        due_at=now + timedelta(days=80),
        raw_due_at=now + timedelta(days=80),
        last_review_at=now - timedelta(days=10),
        content_fingerprint="fp",
        state_source="manual",
        schedule_source="manual",
    )
    session.add(row)
    session.commit()
    return row


def test_rebuild_replays_direct_and_reclaims_polluted(db_session):
    palace = _palace(db_session)
    # real：三次真实复习，但行内 S 被吹高到 90（模拟污染叠加）。
    _event(db_session, palace.id, "real", rating=3, origin="direct", offset_days=20)
    _event(db_session, palace.id, "real", rating=3, origin="direct", offset_days=12)
    _event(db_session, palace.id, "real", rating=2, origin="direct", offset_days=5)
    _event(db_session, palace.id, "real", rating=4, origin="batch_inherited", offset_days=4)
    _inflated_row(db_session, palace.id, "real")
    # polluted：只有批量继承证据，从未真实回忆过。
    _event(db_session, palace.id, "polluted", rating=4, origin="batch_inherited", offset_days=8)
    _inflated_row(db_session, palace.id, "polluted")
    db_session.commit()

    preview = preview_rebuild(db_session)
    assert preview["rebuilt_count"] == 1
    assert preview["to_backlog_count"] == 1
    assert preview["due_earlier_count"] == 1  # real 的虚高 due 被拉回

    result = execute_rebuild(db_session)
    db_session.commit()
    assert result["affected_node_count"] == 2

    real = db_session.query(ReviewNodeState).filter_by(
        palace_id=palace.id, node_uid="real"
    ).one()
    # 重放三次真实评分（含一次困难）后的 S 远低于吹高的 90。
    assert real.stability is not None and real.stability < 60
    assert real.due_at == real.raw_due_at
    assert real.schedule_reason == "kernel_rebuild_v1"
    # polluted 删行回 backlog。
    assert (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="polluted")
        .first()
        is None
    )

    rollback = rollback_rebuild(db_session, operation_id=result["operation_id"])
    db_session.commit()
    assert rollback["restored_node_count"] == 2
    restored_real = db_session.query(ReviewNodeState).filter_by(
        palace_id=palace.id, node_uid="real"
    ).one()
    assert restored_real.stability == 90.0
    restored_polluted = db_session.query(ReviewNodeState).filter_by(
        palace_id=palace.id, node_uid="polluted"
    ).one()
    assert restored_polluted.stability == 90.0


def test_rebuild_cancels_open_formal_waves(db_session):
    from memory_anki.infrastructure.db._tables.reviews import ReviewWave

    palace = _palace(db_session)
    _event(db_session, palace.id, "real", rating=3, origin="direct", offset_days=3)
    _inflated_row(db_session, palace.id, "real")
    db_session.add(
        ReviewWave(
            id="fw-open",
            palace_id=palace.id,
            wave_type="formal_long_term",
            status="scheduled",
            local_date=datetime.now(UTC).date() + timedelta(days=5),
        )
    )
    db_session.commit()

    result = execute_rebuild(db_session, palace_ids=[palace.id])
    db_session.commit()
    assert result["cancelled_wave_count"] == 1
    wave = db_session.get(ReviewWave, "fw-open")
    assert wave.status == "cancelled"
