"""Review queue queries and read-side payload assembly."""

from __future__ import annotations

import json
from collections import OrderedDict
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewSchedule
from memory_anki.modules.reviews.application.review_metrics_service import (
    get_weekly_stats,
)
from memory_anki.modules.reviews.application.schedule_service import (
    get_config_value,
    is_schedule_due,
    is_schedule_overdue,
    schedule_display_datetime,
)


def _due_query(session: Session, chapter_id: int | None = None) -> list[ReviewSchedule]:
    today = date.today()
    now = datetime.now()
    query = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.mastered == False,
            Palace.archived == False,
            Palace.deleted_at.is_(None),
            or_(
                ReviewSchedule.scheduled_date <= today,
                ReviewSchedule.scheduled_at <= now,
            ),
        )
        .order_by(
            ReviewSchedule.scheduled_date,
            ReviewSchedule.review_number,
            ReviewSchedule.id,
        )
    )
    if chapter_id is not None:
        query = query.filter(Palace.chapters.any(Chapter.id == chapter_id))
    schedules = query.all()
    now = datetime.now()
    return [
        schedule
        for schedule in schedules
        if schedule.palace and is_schedule_due(schedule, schedule.palace, session, now=now)
    ]


def _group_due_reviews(
    reviews: list[ReviewSchedule],
    session: Session,
    respect_daily_limit: bool = True,
    daily_limit: int = 0,
) -> list[dict]:
    grouped: OrderedDict[int, dict] = OrderedDict()
    for schedule in reviews:
        palace_id = schedule.palace_id
        group = grouped.get(palace_id)
        if group is None:
            if respect_daily_limit and daily_limit > 0 and len(grouped) >= daily_limit:
                continue
            group = {
                "schedule": schedule,
                "schedule_count": 0,
                "overdue_schedule_count": 0,
                "next_due_date": schedule.scheduled_date,
            }
            grouped[palace_id] = group

        group["schedule_count"] += 1
        if schedule.palace and is_schedule_overdue(schedule, schedule.palace, session):
            group["overdue_schedule_count"] += 1
        if schedule.scheduled_date < group["next_due_date"]:
            group["next_due_date"] = schedule.scheduled_date
            group["schedule"] = schedule
    return list(grouped.values())


def get_today_reviews(
    session: Session,
    chapter_id: int | None = None,
    respect_daily_limit: bool = True,
) -> list[ReviewSchedule]:
    reviews = _due_query(session, chapter_id=chapter_id)
    if chapter_id is not None:
        respect_daily_limit = False
    max_per_day = int(get_config_value(session, "daily_max_reviews") or "0")
    if respect_daily_limit and max_per_day > 0:
        return reviews[:max_per_day]
    return reviews


def get_today_review_groups(
    session: Session,
    chapter_id: int | None = None,
    respect_daily_limit: bool = True,
) -> list[dict]:
    reviews = _due_query(session, chapter_id=chapter_id)
    if chapter_id is not None:
        respect_daily_limit = False
    max_per_day = int(get_config_value(session, "daily_max_reviews") or "0")
    return _group_due_reviews(
        reviews,
        session,
        respect_daily_limit=respect_daily_limit,
        daily_limit=max_per_day,
    )


def get_later_today_review_groups(
    session: Session,
    chapter_id: int | None = None,
    *,
    now: datetime | None = None,
) -> list[dict]:
    current = now or datetime.now()
    today = current.date()
    tomorrow_start = datetime.combine(today + timedelta(days=1), time.min)
    next_schedule_ids = (
        session.query(
            ReviewSchedule.id.label("schedule_id"),
            func.row_number()
            .over(
                partition_by=ReviewSchedule.palace_id,
                order_by=(ReviewSchedule.review_number.asc(), ReviewSchedule.id.asc()),
            )
            .label("position"),
        )
        .join(Palace, Palace.id == ReviewSchedule.palace_id)
        .filter(
            ReviewSchedule.completed == False,
            Palace.mastered == False,
            Palace.archived == False,
            Palace.deleted_at.is_(None),
        )
    )
    if chapter_id is not None:
        next_schedule_ids = next_schedule_ids.filter(Palace.chapters.any(Chapter.id == chapter_id))
    next_schedule_ids = next_schedule_ids.subquery()

    rows = (
        session.query(ReviewSchedule)
        .join(Palace, Palace.id == ReviewSchedule.palace_id)
        .join(next_schedule_ids, next_schedule_ids.c.schedule_id == ReviewSchedule.id)
        .filter(
            next_schedule_ids.c.position == 1,
            or_(
                ReviewSchedule.scheduled_date <= today,
                ReviewSchedule.scheduled_at < tomorrow_start,
            ),
        )
        .order_by(
            ReviewSchedule.scheduled_date.asc(),
            ReviewSchedule.review_number.asc(),
            ReviewSchedule.id.asc(),
        )
        .all()
    )

    groups: list[tuple[datetime, dict]] = []
    for schedule in rows:
        if schedule.palace is None:
            continue
        due_at = schedule_display_datetime(schedule, schedule.palace, session)
        if due_at is None or due_at <= current or due_at.date() != today:
            continue
        groups.append(
            (
                due_at,
                {
                    "schedule": schedule,
                    "schedule_count": 1,
                    "overdue_schedule_count": 0,
                    "next_due_date": schedule.scheduled_date,
                },
            )
        )
    return [group for _, group in sorted(groups, key=lambda item: item[0])]


def get_next_due_review(
    session: Session,
    exclude_schedule_id: int | None = None,
    chapter_id: int | None = None,
) -> ReviewSchedule | None:
    reviews = _due_query(session, chapter_id=chapter_id)
    excluded_palace_id: int | None = None
    if exclude_schedule_id is not None:
        excluded_schedule = session.query(ReviewSchedule).filter_by(id=exclude_schedule_id).first()
        excluded_palace_id = excluded_schedule.palace_id if excluded_schedule else None

    groups = _group_due_reviews(reviews, session, respect_daily_limit=False)
    for group in groups:
        schedule = group["schedule"]
        if excluded_palace_id is not None and schedule.palace_id == excluded_palace_id:
            continue
        return schedule
    return None


def get_overdue_count(session: Session) -> int:
    today = date.today()
    today_start = datetime.combine(today, time.min)
    schedules = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.mastered == False,
            Palace.archived == False,
            Palace.deleted_at.is_(None),
            or_(
                ReviewSchedule.scheduled_date < today,
                ReviewSchedule.scheduled_at < today_start,
            ),
        )
        .all()
    )
    now = datetime.now()
    overdue_palace_ids = {
        schedule.palace_id
        for schedule in schedules
        if schedule.palace and is_schedule_overdue(schedule, schedule.palace, session, now=now)
    }
    return len(overdue_palace_ids)


def get_due_count(session: Session) -> int:
    return len(get_today_review_groups(session))


def _palace_has_started_review_progress(palace: Palace | None) -> bool:
    if palace is None:
        return False
    if any(bool(getattr(schedule, "completed", False)) for schedule in (palace.review_schedules or [])):
        return True
    return any(
        getattr(log, "review_mode", "") == "review"
        for log in (palace.review_logs or [])
    )


_SPREAD_UNDO_KEY = "overdue_spread_undo_snapshot"


def _save_spread_undo_snapshot(session: Session, moves: list[dict]) -> None:
    from memory_anki.infrastructure.db._tables.misc import Config

    row = session.query(Config).filter_by(key=_SPREAD_UNDO_KEY).first()
    payload = json.dumps({"created_at": datetime.now().isoformat(), "moves": moves})
    if row:
        row.value = payload
    else:
        session.add(Config(key=_SPREAD_UNDO_KEY, value=payload))


def undo_spread_overdue(session: Session) -> int:
    from memory_anki.infrastructure.db._tables.misc import Config

    row = session.query(Config).filter_by(key=_SPREAD_UNDO_KEY).first()
    if not row or not row.value:
        return 0
    snapshot = json.loads(row.value)
    restored = 0
    for move in snapshot.get("moves", []):
        schedule = session.query(ReviewSchedule).filter_by(id=move["schedule_id"]).first()
        if schedule is None or schedule.completed:
            continue
        schedule.scheduled_date = date.fromisoformat(move["old_date"])
        schedule.scheduled_at = (
            datetime.fromisoformat(move["old_at"]) if move.get("old_at") else None
        )
        restored += 1
    row.value = ""
    session.commit()
    return restored


def spread_overdue(
    session: Session,
    days: int = 7,
    dry_run: bool = False,
    *,
    commit: bool = True,
) -> dict:
    today = date.today()
    candidates = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.mastered == False,
            Palace.archived == False,
            Palace.deleted_at.is_(None),
        )
        .order_by(ReviewSchedule.scheduled_date, ReviewSchedule.id)
        .all()
    )
    now = datetime.now()
    overdue = [
        schedule
        for schedule in candidates
        if schedule.palace
        and is_schedule_overdue(schedule, schedule.palace, session, now=now)
        and _palace_has_started_review_progress(schedule.palace)
    ]
    if not overdue or days <= 0:
        return {"count": 0, "moves": []}

    per_day = max(1, len(overdue) // days)
    moves: list[dict] = []
    for index, schedule in enumerate(overdue):
        offset = index // per_day
        next_date = today + timedelta(days=min(offset, days - 1))
        previous_due_at = (
            schedule_display_datetime(schedule, schedule.palace, session)
            if schedule.palace
            else None
        )
        moves.append(
            {
                "schedule_id": schedule.id,
                "palace_id": schedule.palace_id,
                "palace_title": schedule.palace.title if schedule.palace else "",
                "old_date": schedule.scheduled_date.isoformat(),
                "old_at": schedule.scheduled_at.isoformat() if schedule.scheduled_at else None,
                "new_date": next_date.isoformat(),
            }
        )
        if not dry_run:
            schedule.scheduled_date = next_date
            if previous_due_at is not None:
                schedule.scheduled_at = datetime.combine(next_date, previous_due_at.time())
    if not dry_run:
        _save_spread_undo_snapshot(session, moves)
        if commit:
            session.commit()
        else:
            session.flush()
    return {"count": len(moves), "moves": moves}


def maybe_auto_smooth_overdue(session: Session) -> int:
    enabled = get_config_value(session, "auto_smooth_overdue") == "true"
    if not enabled:
        return 0
    threshold = int(get_config_value(session, "overdue_smoothing_threshold") or "0")
    days = int(get_config_value(session, "overdue_smoothing_days") or "7")
    overdue_count = get_overdue_count(session)
    if overdue_count <= 0 or days <= 0:
        return 0
    if threshold > 0 and overdue_count < threshold:
        return 0
    return spread_overdue(session, days)["count"]


def get_review_queue_payload(session: Session, chapter_id: int | None = None) -> dict:
    reviews = get_today_review_groups(
        session,
        chapter_id=chapter_id,
        respect_daily_limit=chapter_id is None,
    )
    later_today_reviews = get_later_today_review_groups(session, chapter_id=chapter_id)
    return {
        "due_count": len(reviews),
        "later_today_count": len(later_today_reviews),
        "overdue_count": get_overdue_count(session),
        "smoothed_count": 0,
        "stats": get_weekly_stats(session),
        "reviews": reviews,
        "later_today_reviews": later_today_reviews,
    }


def get_chapter_queue_payload(session: Session, chapter_id: int) -> dict:
    chapter = session.query(Chapter).filter_by(id=chapter_id).first()
    payload = get_review_queue_payload(session, chapter_id=chapter_id)
    payload["chapter"] = chapter
    return payload
