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


def _node_fingerprint(session, palace_id, uid):
    """真实内容指纹——用假值会让 rate_nodes 把已有状态当成全新卡丢弃。"""
    from memory_anki.infrastructure.db._tables.palaces import Palace as _Palace
    from memory_anki.modules.memory.application.node_memory_projection import _tree

    _root, nodes = _tree(session.get(_Palace, palace_id))
    return nodes[uid]["content_fingerprint"]


def _seed_state(session, palace_id, uid, *, due_in_days, stability=30.0):
    now = utc_now_naive()
    row = (
        session.query(ReviewNodeState)
        .filter_by(palace_id=palace_id, node_uid=uid)
        .first()
    )
    if row is None:
        row = ReviewNodeState(palace_id=palace_id, node_uid=uid)
        session.add(row)
    row.state = 2  # fsrs.State.Review
    row.stability = stability
    row.difficulty = 5.0
    row.due_at = now + timedelta(days=due_in_days)
    row.raw_due_at = now + timedelta(days=due_in_days)
    row.last_review_at = now - timedelta(days=max(1, int(stability)))
    row.desired_retention = 0.9
    row.maximum_interval = 36500
    row.content_fingerprint = _node_fingerprint(session, palace_id, uid)
    row.state_source = "manual"
    row.schedule_source = "manual"
    session.commit()
    return row


def test_unit_scheduling_is_the_default(db_session):
    """默认按宫殿整批调度；用户可显式切回逐卡（逃生舱）。"""
    from memory_anki.infrastructure.db._tables.misc import Config
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        unit_mode_for,
    )

    palace = _palace(db_session, ["a"])
    assert unit_mode_for(db_session, palace.id) == "unit"
    assert aggregation_enabled(db_session, palace.id) is True

    # 宫殿级显式关闭。
    upsert_palace_review_settings(db_session, palace.id, aggregation_enabled=False)
    db_session.commit()
    assert unit_mode_for(db_session, palace.id) == "card"
    assert aggregation_enabled(db_session, palace.id) is False

    # 全局切回逐卡；未表态的宫殿跟随全局。
    other = _palace(db_session, ["b"])
    db_session.add(Config(key="scheduling_unit_mode", value="card"))
    db_session.commit()
    assert unit_mode_for(db_session, other.id) == "card"


def test_compute_and_apply_aggregation_clusters_within_asymmetric_window(db_session):
    palace = _palace(db_session, ["a", "b", "c"])
    _seed_state(db_session, palace.id, "a", due_in_days=3)
    _seed_state(db_session, palace.id, "b", due_in_days=4)
    _seed_state(db_session, palace.id, "c", due_in_days=5)
    upsert_palace_review_settings(db_session, palace.id, aggregation_enabled=True)
    db_session.commit()

    preview = compute_aggregation(db_session, palace_id=palace.id, horizon_days=30)
    # 三张卡窗口互相覆盖，应全部聚到同一天。
    assert len(preview.moves) >= 2
    target_days = {m.target_local for m in preview.moves}
    assert len(target_days) == 1
    # 打平时偏向"总提前最少"：质心不该落在最早那张卡之前。
    earliest_raw = min(m.raw_due_local for m in preview.moves)
    assert next(iter(target_days)) >= earliest_raw

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


def test_unit_aggregation_converges_twenty_cards_into_at_most_two_waves(db_session):
    """核心断言：6–15 天散开的一批卡，单元聚类后应收敛到 ≤2 个波次日。

    6 天与 15 天的卡不可能合并（把 6 天推到 13 天是 +117%），这是 FSRS 固有
    几何——所以断言的是 2 而不是 1。
    """
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        compute_unit_aggregation,
    )

    spread = [6, 6, 7, 7, 8, 8, 8, 9, 9, 11, 11, 12, 13, 13, 14, 15, 15, 15, 10, 10]
    uids = [f"n{i}" for i in range(len(spread))]
    palace = _palace(db_session, uids)
    for uid, days in zip(uids, spread, strict=True):
        _seed_state(db_session, palace.id, uid, due_in_days=days, stability=float(days))
    db_session.commit()

    preview = compute_unit_aggregation(
        db_session, palace_id=palace.id, unit_root_uid="root"
    )
    assert len(preview.waves) <= 2, [
        (w.local_date.isoformat(), len(w.node_uids)) for w in preview.waves
    ]
    assert len(preview.waves) >= 1
    # 每个保留的波次都必须够 min_wave_cards，小簇解散进巩固清单。
    for wave in preview.waves:
        assert len(wave.node_uids) >= 3
    covered = sum(len(w.node_uids) for w in preview.waves) + len(
        preview.consolidate_node_uids
    )
    assert covered == len(spread)


def test_unit_aggregation_never_rewrites_raw_due(db_session):
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        apply_unit_aggregation,
        compute_unit_aggregation,
    )

    uids = [f"n{i}" for i in range(6)]
    palace = _palace(db_session, uids)
    for index, uid in enumerate(uids):
        _seed_state(db_session, palace.id, uid, due_in_days=8 + index, stability=20.0)
    db_session.commit()
    before_raw = {
        row.node_uid: row.raw_due_at
        for row in db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id)
        .all()
    }

    preview = compute_unit_aggregation(
        db_session, palace_id=palace.id, unit_root_uid="root"
    )
    apply_unit_aggregation(db_session, palace_id=palace.id, preview=preview)
    db_session.commit()

    for row in (
        db_session.query(ReviewNodeState).filter_by(palace_id=palace.id).all()
    ):
        assert row.raw_due_at == before_raw[row.node_uid], "raw_due_at 是 FSRS 真值，永不改写"
        if row.schedule_source == "wave_adsorb":
            assert "unit_wave raw=" in (row.schedule_reason or "")
            assert f"unit={preview.unit_root_uid}" in (row.schedule_reason or "")


def test_small_cluster_dissolves_into_consolidation(db_session):
    """孤立的卡不建宫殿波次——一张卡撑起一次会话正是碎片化的原型。"""
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        apply_unit_aggregation,
        compute_unit_aggregation,
    )

    uids = ["a", "b", "c", "lonely"]
    palace = _palace(db_session, uids)
    for uid in ("a", "b", "c"):
        _seed_state(db_session, palace.id, uid, due_in_days=10, stability=10.0)
    # 60 天间隔的孤卡：窗口再宽也够不到 10 天那一簇。
    _seed_state(db_session, palace.id, "lonely", due_in_days=60, stability=60.0)
    db_session.commit()

    preview = compute_unit_aggregation(
        db_session, palace_id=palace.id, unit_root_uid="root"
    )
    assert "lonely" in preview.consolidate_node_uids
    assert len(preview.waves) == 1
    assert set(preview.waves[0].node_uids) == {"a", "b", "c"}

    apply_unit_aggregation(db_session, palace_id=palace.id, preview=preview)
    db_session.commit()
    lonely = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="lonely")
        .one()
    )
    assert lonely.schedule_source == "consolidate"
    assert lonely.effective_wave_id is None
    assert lonely.due_at == lonely.raw_due_at  # 巩固卡不挪到期日


def test_learning_and_short_interval_cards_excluded_from_unit_waves(db_session):
    from memory_anki.modules.memory.application.scheduling.aggregation import (
        compute_unit_aggregation,
    )

    palace = _palace(db_session, ["mature1", "mature2", "mature3", "learning", "short"])
    for uid in ("mature1", "mature2", "mature3"):
        _seed_state(db_session, palace.id, uid, due_in_days=12, stability=12.0)
    learning = _seed_state(db_session, palace.id, "learning", due_in_days=12, stability=12.0)
    learning.state = 1  # fsrs.State.Learning
    short = _seed_state(db_session, palace.id, "short", due_in_days=1, stability=1.0)
    short.state = 2
    db_session.commit()

    preview = compute_unit_aggregation(
        db_session, palace_id=palace.id, unit_root_uid="root"
    )
    placed = {uid for wave in preview.waves for uid in wave.node_uids}
    assert placed == {"mature1", "mature2", "mature3"}
    assert "learning" not in placed and "learning" not in preview.consolidate_node_uids
    assert "short" not in placed


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


def test_rating_with_aggregation_enabled_adsorbs_long_interval_only(db_session):
    """开启聚合后：成熟卡的长间隔 due 可吸附；学习步的短间隔 due 永不吸附。

    短间隔判据按**间隔**而非日期——临近午夜时 +1 小时的学习步卡日期上是
    "明天"，但它属于巩固范畴，绝不能唤醒宫殿波次。
    """
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

    # 成熟卡（稳定度 30 天）评分后是长间隔，必须进单元波次。
    _seed_state(db_session, palace.id, "mature", due_in_days=0, stability=30.0)
    rate_nodes(
        db_session,
        palace_id=palace.id,
        node_uid="mature",
        rating=3,
        study_session_id="s-agg-mature",
        operation_id="op-agg-mature",
        rating_scope="single",
        source_scene="practice",
    )
    mature = (
        db_session.query(ReviewNodeState)
        .filter_by(palace_id=palace.id, node_uid="mature")
        .one()
    )
    assert mature.raw_due_at is not None
    assert (mature.raw_due_at - utc_now_naive()) > timedelta(days=3)
    assert mature.effective_wave_id is not None
    # practice 场景的 schedule_source 标记为 practice，波次归属仍生效。
    assert mature.schedule_source in {"wave_adsorb", "practice"}
    assert (mature.schedule_reason or "").startswith(("adsorb_existing", "new_wave"))
