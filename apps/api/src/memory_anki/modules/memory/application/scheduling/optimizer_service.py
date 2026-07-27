"""FSRS 参数一键优化：日志构造 → Optimizer → 前后对比 → 激活/回滚。

依赖 ``fsrs[optimizer]``（torch/pandas，体积大）——lazy import，未安装时
接口返回明确错误而非启动失败。评估用对数损失 + 10 桶校准表，只基于
真实回忆证据（direct / branch_recall），剔除 undone / bulk_mark / 旧
batch_inherited 污染。
"""

from __future__ import annotations

import json
import math
import uuid
from typing import Any

from fsrs import Card, Rating, ReviewLog, Scheduler
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.mindmap import MindMapRecallEvent
from memory_anki.infrastructure.db._tables.reviews import (
    FsrsParameterSet,
    ReviewRatingOperation,
)
from memory_anki.modules.memory.application.fsrs_runtime import load_fsrs_settings

# py-fsrs 官方建议样本量；低于此不做优化。
MIN_REVIEW_LOGS = 400
TRUSTED_ORIGINS = ("direct", "branch_recall")


def collect_review_logs(
    session: Session,
) -> tuple[list[ReviewLog], dict[int, list[ReviewLog]]]:
    """把真实回忆事件转成 py-fsrs ReviewLog（全量 + 按卡分组、时间升序）。"""
    from memory_anki.modules.memory.application.node_memory_projection import _card_id

    undone_ids = {
        row[0]
        for row in session.query(ReviewRatingOperation.id)
        .filter(ReviewRatingOperation.undone_at.is_not(None))
        .all()
    }
    events = (
        session.query(MindMapRecallEvent)
        .filter(MindMapRecallEvent.evidence_origin.in_(TRUSTED_ORIGINS))
        .order_by(MindMapRecallEvent.occurred_at.asc(), MindMapRecallEvent.created_at.asc())
        .all()
    )
    by_card: dict[int, list[ReviewLog]] = {}
    for event in events:
        if event.operation_id and event.operation_id in undone_ids:
            continue
        occurred = getattr(event, "occurred_at", None) or event.created_at
        if occurred is None:
            continue
        # DB 存 UTC-naive；py-fsrs 要求 tz-aware UTC。
        from datetime import UTC

        occurred = (
            occurred.replace(tzinfo=UTC)
            if occurred.tzinfo is None
            else occurred.astimezone(UTC)
        )
        rating = 3 if event.rating == 5 else int(event.rating)
        if rating not in (1, 2, 3, 4):
            continue
        card_id = _card_id(int(event.palace_id), str(event.node_uid))
        by_card.setdefault(card_id, []).append(
            ReviewLog(
                card_id=card_id,
                rating=Rating(rating),
                review_datetime=occurred,
                review_duration=event.response_ms,
            )
        )
    flat = [log for logs in by_card.values() for log in logs]
    flat.sort(key=lambda log: log.review_datetime)
    return flat, by_card


def evaluate_parameters(
    by_card: dict[int, list[ReviewLog]],
    parameters: tuple[float, ...] | None,
) -> dict[str, Any]:
    """重放日志计算对数损失与 10 桶校准（预测保持率 vs 实际记得率）。

    每张卡从空白开始重放；首个事件没有先验预测，不计入损失。
    """
    from datetime import UTC

    kwargs: dict[str, Any] = {"enable_fuzzing": False}
    if parameters:
        kwargs["parameters"] = tuple(parameters)
    scheduler = Scheduler(**kwargs)
    losses: list[float] = []
    buckets: list[list[int]] = [[0, 0] for _ in range(10)]  # [n, remembered]
    for card_id, logs in by_card.items():
        card = Card(card_id=card_id)
        for index, log in enumerate(logs):
            review_at = log.review_datetime
            if review_at.tzinfo is None:
                review_at = review_at.replace(tzinfo=UTC)
            if index > 0 and card.last_review is not None:
                p = float(
                    scheduler.get_card_retrievability(card, current_datetime=review_at)
                )
                p = min(max(p, 1e-6), 1.0 - 1e-6)
                y = 0.0 if int(log.rating) == 1 else 1.0
                losses.append(-(y * math.log(p) + (1.0 - y) * math.log(1.0 - p)))
                bucket = min(9, int(p * 10))
                buckets[bucket][0] += 1
                buckets[bucket][1] += int(y)
            card, _ = scheduler.review_card(
                card, Rating(int(log.rating)), review_datetime=review_at
            )
    calibration = [
        {
            "bucket": f"{i / 10:.1f}-{(i + 1) / 10:.1f}",
            "count": n,
            "predicted_mid": round((i + 0.5) / 10, 2),
            "actual_recall": round(remembered / n, 4) if n else None,
        }
        for i, (n, remembered) in enumerate(buckets)
    ]
    return {
        "log_loss": round(sum(losses) / len(losses), 6) if losses else None,
        "sample_count": len(losses),
        "calibration": calibration,
    }


def optimizer_available() -> bool:
    try:
        from fsrs.optimizer import Optimizer  # noqa: F401
    except Exception:
        return False
    return True


def start_optimization(session: Session, *, min_reviews: int = MIN_REVIEW_LOGS) -> dict[str, Any]:
    """创建 candidate 参数集并同步准备日志；实际训练由后台任务执行。"""
    if not optimizer_available():
        raise ValueError(
            "优化器依赖未安装：pip install -r requirements-optimizer.txt"
        )
    flat, _by_card = collect_review_logs(session)
    if len(flat) < min_reviews:
        raise ValueError(
            f"真实复习记录不足（{len(flat)}/{min_reviews}），继续积累后再优化"
        )
    running = (
        session.query(FsrsParameterSet)
        .filter(FsrsParameterSet.status == "running")
        .first()
    )
    if running is not None:
        raise ValueError("已有优化任务在运行")
    row = FsrsParameterSet(
        id=f"ps-{uuid.uuid4()}",
        status="running",
        source="optimized",
        sample_count=len(flat),
        created_at=utc_now_naive(),
    )
    session.add(row)
    session.flush()
    return {"parameter_set_id": row.id, "review_log_count": len(flat)}


def run_optimization(set_id: str, *, min_reviews: int = MIN_REVIEW_LOGS) -> None:
    """后台执行：训练 + 前后评估。自建独立会话（BackgroundTasks 场景）。"""
    from memory_anki.infrastructure.db._tables import get_session

    session = get_session()
    try:
        row = session.get(FsrsParameterSet, set_id)
        if row is None:
            return
        try:
            from fsrs.optimizer import Optimizer

            flat, by_card = collect_review_logs(session)
            if len(flat) < min_reviews:
                raise ValueError("真实复习记录不足")
            settings = load_fsrs_settings(session)
            baseline = settings.get("parameters")  # None = 官方默认
            optimizer = Optimizer(flat)
            weights = tuple(float(w) for w in optimizer.compute_optimal_parameters())
            before = evaluate_parameters(by_card, baseline)
            after = evaluate_parameters(by_card, weights)
            row.weights_json = json.dumps(list(weights))
            row.log_loss_before = before["log_loss"]
            row.log_loss_after = after["log_loss"]
            row.calibration_json = json.dumps(
                {"before": before["calibration"], "after": after["calibration"]},
                ensure_ascii=False,
            )
            row.sample_count = len(flat)
            row.status = "candidate"
        except Exception as exc:  # 训练失败要落库可见，不能悄悄消失
            row.status = "failed"
            row.error = str(exc)[:2000]
        session.commit()
    finally:
        session.close()


def optimization_status(session: Session) -> dict[str, Any]:
    rows = (
        session.query(FsrsParameterSet)
        .order_by(FsrsParameterSet.created_at.desc())
        .limit(10)
        .all()
    )
    return {
        "optimizer_available": optimizer_available(),
        "items": [_set_payload(row) for row in rows],
    }


def _set_payload(row: FsrsParameterSet) -> dict[str, Any]:
    calibration = None
    if row.calibration_json:
        try:
            calibration = json.loads(row.calibration_json)
        except (TypeError, ValueError):
            calibration = None
    return {
        "id": row.id,
        "status": row.status,
        "source": row.source,
        "sample_count": row.sample_count,
        "log_loss_before": row.log_loss_before,
        "log_loss_after": row.log_loss_after,
        "calibration": calibration,
        "error": row.error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "activated_at": row.activated_at.isoformat() if row.activated_at else None,
    }


def activate_parameter_set(session: Session, set_id: str) -> dict[str, Any]:
    row = session.get(FsrsParameterSet, set_id)
    if row is None:
        raise ValueError("parameter set not found")
    if row.status not in {"candidate", "rolled_back"}:
        raise ValueError(f"parameter set is {row.status}, cannot activate")
    if not row.weights_json or not json.loads(row.weights_json):
        raise ValueError("parameter set has no weights")
    now = utc_now_naive()
    for active in (
        session.query(FsrsParameterSet).filter(FsrsParameterSet.status == "active").all()
    ):
        active.status = "rolled_back"
        active.deactivated_at = now
    row.status = "active"
    row.activated_at = now
    # 会话级 FSRS 设置缓存失效，让新权重立即生效。
    session.info.pop("_fsrs_settings", None)
    session.info.pop("_fsrs_scheduler", None)
    session.flush()
    return _set_payload(row)


def rollback_active_parameter_set(session: Session) -> dict[str, Any]:
    """停用当前激活集，回到官方默认参数。"""
    now = utc_now_naive()
    changed = None
    for active in (
        session.query(FsrsParameterSet).filter(FsrsParameterSet.status == "active").all()
    ):
        active.status = "rolled_back"
        active.deactivated_at = now
        changed = active
    session.info.pop("_fsrs_settings", None)
    session.info.pop("_fsrs_scheduler", None)
    session.flush()
    if changed is None:
        raise ValueError("no active parameter set")
    return _set_payload(changed)
