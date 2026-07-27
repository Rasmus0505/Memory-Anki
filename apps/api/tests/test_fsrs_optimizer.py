"""参数优化：日志构造过滤、评估函数、激活/回滚影响调度参数。"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.reviews import (
    FsrsParameterSet,
    ReviewRatingOperation,
)
from memory_anki.modules.memory.application.fsrs_runtime import load_fsrs_settings
from memory_anki.modules.memory.application.scheduling.optimizer_service import (
    activate_parameter_set,
    collect_review_logs,
    evaluate_parameters,
    optimizer_available,
    rollback_active_parameter_set,
)


def _palace(session):
    palace = Palace(
        title="Opt", description="", difficulty=0, review_mode="review",
        editor_doc=json.dumps(
            {"root": {"data": {"uid": "root", "text": "r"}, "children": [
                {"data": {"uid": "a", "text": "A"}, "children": []}
            ]}}
        ),
    )
    session.add(palace)
    session.commit()
    return palace


def _event(session, palace_id, uid, *, rating, origin, offset_days, op_id=None, event_id=None):
    session.add(
        MindMapRecallEvent(
            id=event_id or f"ev-{uid}-{origin}-{offset_days}-{rating}",
            study_session_id="s-opt",
            palace_id=palace_id,
            node_uid=uid,
            source_scene="formal_review",
            recall_round="first",
            rating=rating,
            rating_source="manual",
            rating_scope="single",
            evidence_origin=origin,
            operation_id=op_id,
            hint_count=0,
            retry_count=0,
            occurred_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=offset_days),
        )
    )


def test_collect_review_logs_filters_untrusted_evidence(db_session):
    palace = _palace(db_session)
    _event(db_session, palace.id, "a", rating=3, origin="direct", offset_days=10)
    _event(db_session, palace.id, "a", rating=3, origin="branch_recall", offset_days=7)
    _event(db_session, palace.id, "a", rating=3, origin="batch_inherited", offset_days=5)
    _event(db_session, palace.id, "a", rating=3, origin="bulk_mark", offset_days=3)
    # undone 的操作剔除
    db_session.add(
        ReviewRatingOperation(
            id="op-undone",
            study_session_id="s-opt",
            palace_id=palace.id,
            root_node_uid="a",
            rating=3,
            rating_scope="single",
            affected_node_count=1,
            undone_at=datetime.now(UTC).replace(tzinfo=None),
        )
    )
    _event(
        db_session, palace.id, "a", rating=3, origin="direct", offset_days=1,
        op_id="op-undone", event_id="ev-undone",
    )
    db_session.commit()

    flat, by_card = collect_review_logs(db_session)
    assert len(flat) == 2  # direct + branch_recall
    assert len(by_card) == 1
    logs = next(iter(by_card.values()))
    assert [int(log.rating) for log in logs] == [3, 3]
    assert logs[0].review_datetime < logs[1].review_datetime


def test_evaluate_parameters_produces_loss_and_calibration(db_session):
    palace = _palace(db_session)
    for offset in (30, 20, 12, 6, 2):
        _event(db_session, palace.id, "a", rating=3, origin="direct", offset_days=offset)
    _event(db_session, palace.id, "a", rating=1, origin="direct", offset_days=1)
    db_session.commit()

    _flat, by_card = collect_review_logs(db_session)
    result = evaluate_parameters(by_card, None)
    assert result["sample_count"] == 5  # 首个事件无先验预测
    assert result["log_loss"] is not None and result["log_loss"] > 0
    assert len(result["calibration"]) == 10


def test_activate_and_rollback_change_scheduler_parameters(db_session):
    weights = [
        0.4, 1.2, 3.1, 15.7, 7.2, 0.5, 1.4, 0.001, 1.5, 0.1,
        1.0, 1.9, 0.1, 0.3, 2.3, 0.2, 2.9, 0.5, 0.6, 0.0, 0.2,
    ]
    row = FsrsParameterSet(
        id="ps-test",
        status="candidate",
        source="optimized",
        sample_count=500,
        weights_json=json.dumps(weights),
    )
    db_session.add(row)
    db_session.commit()

    activate_parameter_set(db_session, "ps-test")
    db_session.commit()
    settings = load_fsrs_settings(db_session)
    assert settings["parameter_version"] == "ps-test"
    assert settings["parameters"] is not None
    assert abs(settings["parameters"][0] - 0.4) < 1e-9

    rollback_active_parameter_set(db_session)
    db_session.commit()
    settings_after = load_fsrs_settings(db_session)
    assert settings_after["parameter_version"] == "default"
    assert settings_after["parameters"] is None


@pytest.mark.skipif(not optimizer_available(), reason="fsrs[optimizer] 未安装")
def test_optimizer_smoke_small_sample(db_session):
    """小样本冒烟：Optimizer 能跑通并返回全长权重（不校验质量）。"""
    from fsrs.optimizer import Optimizer

    palace = _palace(db_session)
    base = 200
    for index in range(60):
        _event(
            db_session, palace.id, "a",
            rating=1 if index % 7 == 0 else 3,
            origin="direct",
            offset_days=base - index * 3,
            event_id=f"ev-smoke-{index}",
        )
    db_session.commit()
    flat, _ = collect_review_logs(db_session)
    weights = Optimizer(flat).compute_optimal_parameters()
    assert len(weights) == 21
