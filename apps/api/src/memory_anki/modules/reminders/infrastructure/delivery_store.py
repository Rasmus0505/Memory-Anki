"""投递记录读写：去重依据 + 设置页的"最近一次结果"。"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.notifications import ReminderDelivery
from memory_anki.modules.reminders.domain.schemas import DeliveryState

RETENTION_DAYS = 30


def load_delivery_states(session: Session, study_day: date) -> dict[str, DeliveryState]:
    rows = (
        session.query(ReminderDelivery)
        .filter(ReminderDelivery.study_day == study_day)
        .all()
    )
    return {
        row.slot: DeliveryState(
            status=row.status,
            attempts=row.attempts,
            last_attempt_at=row.last_attempt_at,
        )
        for row in rows
    }


def record_attempt(
    session: Session,
    *,
    study_day: date,
    slot: str,
    ok: bool,
    title: str,
    body: str,
    http_status: int | None = None,
    error: str = "",
    now: datetime | None = None,
) -> None:
    """记一次投递。唯一约束保证同一时段只有一行，重试只累加 attempts。"""
    moment = now or utc_now_naive()
    row = (
        session.query(ReminderDelivery)
        .filter(
            ReminderDelivery.study_day == study_day,
            ReminderDelivery.slot == slot,
        )
        .first()
    )
    if row is None:
        row = ReminderDelivery(study_day=study_day, slot=slot, attempts=0)
        session.add(row)
    row.attempts = int(row.attempts or 0) + 1
    row.status = "sent" if ok else "failed"
    row.title = title[:200]
    row.body = body[:400]
    row.http_status = http_status
    row.error = error[:500]
    row.last_attempt_at = moment
    row.updated_at = moment
    session.flush()


def count_sent_on(session: Session, study_day: date) -> int:
    """今天真正送出去几条（失败的不算，不占每日上限）。"""
    return int(
        session.query(ReminderDelivery)
        .filter(
            ReminderDelivery.study_day == study_day,
            ReminderDelivery.status == "sent",
        )
        .count()
    )


def latest_delivery(session: Session) -> ReminderDelivery | None:
    return (
        session.query(ReminderDelivery)
        .order_by(ReminderDelivery.updated_at.desc(), ReminderDelivery.id.desc())
        .first()
    )


def consecutive_failures(session: Session, limit: int = 5) -> int:
    rows = (
        session.query(ReminderDelivery)
        .filter(ReminderDelivery.status != "pending")
        .order_by(ReminderDelivery.updated_at.desc(), ReminderDelivery.id.desc())
        .limit(limit)
        .all()
    )
    count = 0
    for row in rows:
        if row.status != "failed":
            break
        count += 1
    return count


def prune_deliveries(session: Session, *, keep_days: int = RETENTION_DAYS) -> int:
    cutoff = utc_now_naive() - timedelta(days=keep_days)
    removed = (
        session.query(ReminderDelivery)
        .filter(ReminderDelivery.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    return int(removed or 0)
