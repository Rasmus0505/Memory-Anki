"""到期与完成统计：只做读取，不写业务状态。

复用 ``modules.memory`` 的公开读能力，不在这里重写 SQL；
"今天/昨天"一律走 ``core.time`` 的学习日口径（凌晨 3 点翻页）。

两个"到期"必须分开，否则"到期就绪"永远触发不了：

- ``ready_now``：现在就能刷的（10 分钟台阶已放行）
- ``due_today``：加上排在今天稍后（台阶未到）的

只数前者会让早上 8:30 的提醒低估一整天的量；只数后者会看不见"刚放出来几张"。
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy.orm import Session

from memory_anki.core.time import (
    local_calendar_day_bounds_as_utc_naive,
    resolve_local_timezone,
    study_day_start_hour,
    utc_now_naive,
)
from memory_anki.modules.memory.api import (
    count_rating_days,
    count_unit_review_ratings,
    list_trusted_due_units_for_queue,
    summarize_due_retention,
    summarize_waiting_units,
)
from memory_anki.modules.reminders.application.activity_probe import streak_days
from memory_anki.modules.reminders.domain.schemas import DueSnapshot


def read_due_counts(
    session: Session, study_day: date, *, now: datetime | None = None
) -> tuple[int, int, int]:
    """(现在能刷的, 今天一共到期, 最老一张逾期几天)。

    逾期天数直接从已加载的 due_date 里算，不再多查一次库。
    """
    ready = list_trusted_due_units_for_queue(session, study_day, now=now)
    waiting = summarize_waiting_units(session, study_day, now=now)
    overdue_days = 0
    for row in ready:
        due_date = row.get("due_date")
        if due_date is None:
            continue
        gap = (study_day - due_date).days
        if gap > overdue_days:
            overdue_days = gap
    return len(ready), len(ready) + int(waiting.get("count") or 0), overdue_days


def count_completed_on(session: Session, day: date) -> int:
    start, end = local_calendar_day_bounds_as_utc_naive(day)
    return count_unit_review_ratings(session, start=start, end=end)


def read_time_ledger(
    session: Session,
    study_day: date,
    *,
    now: datetime,
    quiet_start_hour: int,
) -> tuple[float, int, float]:
    """(今天已过去几小时, 有产出的整点数, 还剩下几小时)。

    "累计多久没动"就是前两个数的差。不用会话时长表：那张表在评分路径上
    并非每个场景都写，拿它当时长账本会少算；"这个整点有评过分"是硬的。
    """
    day_start, _ = local_calendar_day_bounds_as_utc_naive(study_day)
    elapsed = max(0.0, (now - day_start).total_seconds() / 3600)
    rows = count_rating_days(session, start=day_start, end=now + timedelta(seconds=1))
    zone = resolve_local_timezone()
    active_hours = len(
        {
            created_at.replace(tzinfo=UTC).astimezone(zone).hour
            for created_at, _ in rows
            if created_at is not None
        }
    )
    # 今天还剩多久：到免打扰开始为止；没设免打扰就按学习日结束（凌晨 3 点）算。
    deadline_hour = quiet_start_hour or study_day_start_hour()
    return elapsed, active_hours, remaining_hours(now, deadline_hour)


def remaining_hours(now_utc: datetime, deadline_hour: int) -> float:
    """距离今天的截止点还有几小时（按本地挂钟）。"""
    zone = resolve_local_timezone()
    aware = now_utc.replace(tzinfo=UTC) if now_utc.tzinfo is None else now_utc
    local = aware.astimezone(zone)
    deadline = local.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
        hours=deadline_hour
    )
    # 截止点永远是"下一个"该钟点：15:00 时"凌晨 3 点"指的是明天凌晨，
    # 否则一觉醒来这一句会算成 0 小时，把紧迫感说反。
    while deadline <= local:
        deadline += timedelta(days=1)
    return (deadline - local).total_seconds() / 3600


def read_due_snapshot(
    session: Session,
    study_day: date,
    *,
    now: datetime | None = None,
    include_streak: bool = False,
    quiet_start_hour: int = 0,
) -> DueSnapshot:
    moment = now or utc_now_naive()
    ready_now, due_today, overdue_days = read_due_counts(session, study_day, now=moment)
    last_hour = count_unit_review_ratings(
        session, start=moment - timedelta(hours=1), end=moment + timedelta(seconds=1)
    )
    retention = summarize_due_retention(session, study_day, now=moment)
    elapsed_hours, active_hours, hours_left = read_time_ledger(
        session, study_day, now=moment, quiet_start_hour=quiet_start_hour
    )
    return DueSnapshot(
        due_count=due_today,
        ready_now_count=ready_now,
        completed_today=count_completed_on(session, study_day),
        completed_yesterday=count_completed_on(session, study_day - timedelta(days=1)),
        completed_last_hour=last_hour,
        # 连续天数要扫 90 天的评分行，只在真的要发小结时才算。
        streak_days=streak_days(session, study_day) if include_streak else 0,
        oldest_overdue_days=overdue_days,
        average_retention=retention.average,
        lowest_retention=retention.lowest,
        at_risk_units=retention.at_risk_units,
        elapsed_hours_today=elapsed_hours,
        active_hours_today=active_hours,
        hours_left_today=hours_left,
    )
