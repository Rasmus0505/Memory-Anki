"""到期与完成统计：只做读取，不写业务状态。

复用 ``modules.memory`` 的公开读能力，不在这里重写 SQL；
"今天/昨天"一律走 ``core.time`` 的学习日口径（凌晨 3 点翻页）。

两个"到期"必须分开，否则"到期就绪"永远触发不了：

- ``ready_now``：现在就能刷的（10 分钟台阶已放行）
- ``due_today``：加上排在今天稍后（台阶未到）的

只数前者会让早上 8:30 的提醒低估一整天的量；只数后者会看不见"刚放出来几张"。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_bounds_as_utc_naive, utc_now_naive
from memory_anki.modules.memory.api import (
    count_unit_review_ratings,
    list_trusted_due_units_for_queue,
    summarize_waiting_units,
)
from memory_anki.modules.reminders.application.activity_probe import streak_days
from memory_anki.modules.reminders.domain.schemas import DueSnapshot


def read_due_counts(
    session: Session, study_day: date, *, now: datetime | None = None
) -> tuple[int, int]:
    """(现在能刷的, 今天一共到期)。"""
    ready = list_trusted_due_units_for_queue(session, study_day, now=now)
    waiting = summarize_waiting_units(session, study_day, now=now)
    return len(ready), len(ready) + int(waiting.get("count") or 0)


def count_completed_on(session: Session, day: date) -> int:
    start, end = local_calendar_day_bounds_as_utc_naive(day)
    return count_unit_review_ratings(session, start=start, end=end)


def read_due_snapshot(
    session: Session,
    study_day: date,
    *,
    now: datetime | None = None,
    include_streak: bool = False,
) -> DueSnapshot:
    moment = now or utc_now_naive()
    ready_now, due_today = read_due_counts(session, study_day, now=moment)
    last_hour = count_unit_review_ratings(
        session, start=moment - timedelta(hours=1), end=moment + timedelta(seconds=1)
    )
    return DueSnapshot(
        due_count=due_today,
        ready_now_count=ready_now,
        completed_today=count_completed_on(session, study_day),
        completed_yesterday=count_completed_on(session, study_day - timedelta(days=1)),
        completed_last_hour=last_hour,
        # 连续天数要扫 90 天的评分行，只在真的要发小结时才算。
        streak_days=streak_days(session, study_day) if include_streak else 0,
    )
