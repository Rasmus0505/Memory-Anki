"""到期单元的当前记忆保留率（FSRS retrievability）。

只读投影，用来回答"这批卡现在还记得多少"。它比"还剩多少张"更有说服力：
剩下 60 张但记忆都在 95% 并不急，剩下 20 张但平均只剩 55% 才是真的在流失。

公式用 FSRS 的可提取性曲线（与调度器同一套参数）：
    R(t, S) = (1 + FACTOR * t / S) ** DECAY
其中 DECAY = -0.5，FACTOR = 0.9 ** (1 / DECAY) - 1 = 19/81。
t 是天数，S 是单元当前 stability。

没有 FSRS 状态的单元（纯新卡、未评分）不参与统计：
它们没有"正在遗忘"这回事，把它们算进平均值会把数字稀释掉。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

FSRS_DECAY = -0.5
FSRS_FACTOR = 0.9 ** (1 / FSRS_DECAY) - 1
# 低于这个保留率就算"在流失"，值得在通知里单独提一句。
AT_RISK_RETENTION = 0.70


@dataclass(frozen=True)
class RetentionSummary:
    due_units: int = 0
    measured_units: int = 0
    average: float | None = None
    lowest: float | None = None
    at_risk_units: int = 0


def retrievability(stability: float | None, elapsed_days: float) -> float | None:
    if not stability or stability <= 0:
        return None
    if elapsed_days <= 0:
        return 1.0
    return float((1 + FSRS_FACTOR * elapsed_days / stability) ** FSRS_DECAY)


def summarize_due_retention(
    session: Session, study_day: date, *, now: datetime
) -> RetentionSummary:
    rows = (
        session.query(
            ReviewUnitState.fsrs_stability,
            ReviewUnitState.fsrs_last_review,
            ReviewUnitState.last_passed_at,
        )
        .join(Palace, Palace.id == ReviewUnitState.palace_id)
        .filter(
            ReviewUnitState.active.is_(True),
            ReviewUnitState.due_date <= study_day,
            Palace.deleted_at.is_(None),
            Palace.archived.is_(False),
        )
        .all()
    )
    values: list[float] = []
    for stability, last_review, last_passed in rows:
        anchor = last_review or last_passed
        if anchor is None:
            continue
        elapsed = max(0.0, (now - anchor).total_seconds() / 86_400)
        value = retrievability(stability, elapsed)
        if value is not None:
            values.append(value)
    if not values:
        return RetentionSummary(due_units=len(rows))
    return RetentionSummary(
        due_units=len(rows),
        measured_units=len(values),
        average=sum(values) / len(values),
        lowest=min(values),
        at_risk_units=sum(1 for value in values if value < AT_RISK_RETENTION),
    )
