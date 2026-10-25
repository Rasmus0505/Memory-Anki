"""最近一次"有效动作"发生在什么时候。

"有效动作"只认两种：评过分、脑图内容被保存过。
不算：打开页面、翻页、自动保存空操作、会话心跳——否则你开着页面走开，
系统会一直以为你在学，闲置提醒永远不响。

``palaces.updated_at`` 是脑图保存的唯一可靠落点（没有单独的编辑器状态表），
代价是任何对宫殿行的写都会算作"动作"。这个方向的误判是"少提醒"而不是"多提醒"，
所以可以接受。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from memory_anki.core.time import local_calendar_day_bounds_as_utc_naive, study_day_of
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.memory.api import count_rating_days


@dataclass(frozen=True)
class ActivitySnapshot:
    last_activity_at: datetime | None = None  # UTC-naive
    started_today: bool = False
    streak_days: int = 0


def _last_rating_at(session: Session, *, start: datetime, end: datetime) -> datetime | None:
    rows = count_rating_days(session, start=start, end=end)
    if not rows:
        return None
    return max(row[0] for row in rows)


def _last_palace_edit_at(session: Session, *, start: datetime, end: datetime) -> datetime | None:
    return (
        session.query(func.max(Palace.updated_at))
        .filter(
            Palace.updated_at.is_not(None),
            Palace.updated_at >= start,
            Palace.updated_at < end,
        )
        .scalar()
    )


def streak_days(session: Session, study_day: date, *, lookback_days: int = 90) -> int:
    """连续学习天数：从今天（今天没学就从昨天）往前数，中间断一天即止。"""
    start, _ = local_calendar_day_bounds_as_utc_naive(study_day - timedelta(days=lookback_days))
    _, end = local_calendar_day_bounds_as_utc_naive(study_day)
    rows = count_rating_days(session, start=start, end=end)
    days = {study_day_of(created_at) for created_at, _ in rows}
    if not days:
        return 0
    cursor = study_day if study_day in days else study_day - timedelta(days=1)
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def read_activity(session: Session, study_day: date, *, now: datetime) -> ActivitySnapshot:
    start, _ = local_calendar_day_bounds_as_utc_naive(study_day)
    end = now if now > start else start
    rating_at = _last_rating_at(session, start=start, end=end + timedelta(seconds=1))
    edit_at = _last_palace_edit_at(session, start=start, end=end + timedelta(seconds=1))
    candidates = [value for value in (rating_at, edit_at) if value is not None]
    return ActivitySnapshot(
        last_activity_at=max(candidates) if candidates else None,
        started_today=bool(candidates),
    )
