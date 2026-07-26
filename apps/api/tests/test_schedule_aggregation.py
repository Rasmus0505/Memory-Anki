"""可选聚合层：对称容忍窗聚簇、留痕、可清除还原。"""

from __future__ import annotations

import json
from datetime import timedelta

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.memory.application.node_memory_service import rate_nodes
from memory_anki.modules.memory.application.scheduling.aggregation import (
    aggregation_enabled,
    apply_aggregation,
    clear_aggregation,
    compute_aggregation,
    get_schedule_delta,
    upsert_palace_review_settings,
)
from memory_anki.modules.memory.application.wave_policy import local_date_of


def _palace(session, node_uids):
    children = [
        {"data": {"uid": uid, "text": uid.upper()}, "children": []} for uid in node_uids
    ]
    palace = Palace(
        title="Agg",
        description="",
        difficulty=0,
        review_mode="review",
        editor_doc=json.dumps(
            {"root": {"data": {"uid": "root", "text": "root"}, "children": children}}
        ),
    )
    session.add(palace)
    session.commit()
    return palace


def _seed_state(session, palace_id, uid, *, due_in_days, stability=30.0):
    now = utc_now_naive()
    row = ReviewNodeState(
        palace_id=palace_id,
        node_uid=uid,
        state=2,
        stability=stability,
        difficulty=5.0,
        due_at=now + timedelta(days=due_in_days),
        raw_due_at=now + timedelta(days=due_in_days),
        last_review_at=now - timedelta(days=max(1, int(stability))),
        desired_retention=0.9,
        maximum_interval=36500,
        content_fingerprint="fp",
        state_source="manual",
        schedule_source="manual",
    )
    session.add(row)
    session.commit()
    return row


def test_aggregation_disabled_by_default(db_session):
    palace = _palace(db_session, ["a"])
    assert aggregation_enabled(db_session, palace.id) is False


def test_compute_and_apply_aggregation_clusters_within_symmetric_window(db_session):
    palace = _palace(db_session, ["a", "b", "c"])
    _seed_state(db_session, palace.id, "a", due_in_days=3)
    _seed_state(db_session, palace.id, "b", due_in_days=4)
    _seed_state(db_session, palace.id, "c", due_in_days=5)
    upsert_palace_review_settings(db_session, palace.id, aggregation_enabled=True)
    db_session.commit()

    preview = compute_aggregation(db_session, palace_id=palace.id, horizon_days=30)
    # 三张卡窗口互相覆盖，应聚到同一天：至少挪动两张。
    assert len(preview.moves) >= 2
    target_days = {m.target_local for m in preview.moves}
    assert len(target_days) == 1
    for move in preview.moves:
        assert abs((move.target_local - move.raw_due_local).days) <= 2

    applied = apply_aggregation(db_session, palace_id=palace.id, preview=preview)
    db_session.commit()
    assert applied == len(preview.moves)
    moved = (
        db_session.query(ReviewNodeState)
        .filter(
            ReviewNodeState.palace_id == palace.id,
            ReviewNodeState.schedule_source == "wave_adsorb",
        )
        .all()
    )
    assert len(moved) == applied
    for row in moved:
        assert "aggregated raw=" in (row.schedule_reason or "")
        assert row.raw_due_at is not None
        assert local_date_of(row.due_at) == row.effective_local_date
        delta = get_schedule_delta(row)
        assert delta["shifted"] is True

    # raw_due_at 永不改写。
    raw_days = {
        row.node_uid: local_date_of(row.raw_due_at)
        for row in db_session.query(ReviewNodeState)
        .filter(ReviewNodeState.palace_id == palace.id)
        .all()
    }
    now_local = local_date_of(utc_now_naive())
    assert raw_days["a"] == now_local + timedelta(days=3)
    assert raw_days["b"] == now_local + timedelta(days=4)
    assert raw_days["c"] == now_local + timedelta(days=5)


def test_clear_aggregation_restores_raw_due(db_session):
    palace = _palace(db_session, ["a", "b", "c"])
    _seed_state(db_session, palace.id, "a", due_in_days=3)
    _seed_state(db_session, palace.id, "b", due_in_days=4)
    _seed_state(db_session, palace.id, "c", due_in_days=5)
    upsert_palace_review_settings(db_session, palace.id, aggregation_enabled=True)
    preview = compute_aggregation(db_session, palace_id=palace.id, horizon_days=30)
    apply_aggregation(db_session, palace_id=palace.id, preview=preview)
    db_session.commit()

    cleared = clear_aggregation(db_session, palace_id=palace.id)
    db_session.commit()
    assert cleared == len(preview.moves)
    for row in (
        db_session.query(ReviewNodeState)
        .filter(ReviewNodeState.palace_id == palace.id)
        .all()
    ):
        assert row.due_at == row.raw_due_at
        assert row.effective_wave_id is None


def test_rating_with_aggregation_enabled_adsorbs_future_due_only(db_session):
    """开启聚合后：成熟卡的未来 due 可吸附；学习步当日 due 仍直出。"""
    palace = _palace(db_session, ["mature", "fresh"])
    upsert_palace_review_settings(db_session, palace.id, aggregation_enabled=True)
    db_session.commit()

    # 新卡记得 → 学习步当日 due，必须直出不进波次。
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="fresh",
        rating=3,
        study_session_id="s-agg-fresh",
        operation_id="op-agg-fresh",
        rating_scope="single",
        source_scene="practice",
    )
    fresh = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="fresh")
        .one()
    )
    assert fresh.schedule_reason == "fsrs_direct"
    assert fresh.effective_wave_id is None

    # 反复记得把卡养成熟（多日间隔），最后一次评分应进入聚合波次。
    for index in range(4):
        rate_nodes(
            db_session,
            palace_id=palace.id,
            node_uid="mature",
            rating=3,
            study_session_id="s-agg-mature",
            operation_id=f"op-agg-mature-{index}",
            rating_scope="single",
            source_scene="practice",
        )
        row = (
            db_session.query(ReviewNodeState)
            .filter_by(palace_id=palace.id, node_uid="mature")
            .one()
        )
        row.due_at = utc_now_naive() - timedelta(minutes=1)
        db_session.commit()
    mature = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="mature")
        .one()
    )
    assert mature.raw_due_at is not None
    if local_date_of(mature.raw_due_at) > local_date_of(utc_now_naive()):
        assert mature.effective_wave_id is not None
        # practice 场景的 schedule_source 标记为 practice，波次归属仍生效。
        assert mature.schedule_source in {"wave_adsorb", "practice"}
        assert (mature.schedule_reason or "").startswith(("adsorb_existing", "new_wave"))
