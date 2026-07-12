from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload, selectinload

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceMiniPalace,
    ReviewSchedule,
)
from memory_anki.modules.palaces.api import build_today_new_palace_outline
from memory_anki.modules.reviews.api import (
    get_weekly_stats,
    load_review_schedule_policy,
    schedule_display_datetime_for_policy,
)
from memory_anki.modules.sessions.api import (
    FORMAL_REVIEW_SCENES,
    STUDY_DASHBOARD_SCENES,
    current_month_bounds,
    current_week_bounds,
    date_range_bounds,
    get_all_time_study_session_duration_seconds,
    get_english_study_stats,
    get_study_session_duration_seconds,
    get_today_palace_learning_breakdown,
    month_bounds,
    today_bounds,
)


class DashboardQueryError(ValueError):
    pass


def _dashboard_palace_loader_options():
    return (
        joinedload(Palace.primary_chapter).joinedload(Chapter.parent),
        joinedload(Palace.primary_chapter).joinedload(Chapter.subject),
        selectinload(Palace.chapters).joinedload(Chapter.subject),
        selectinload(Palace.chapters).joinedload(Chapter.parent),
        selectinload(Palace.review_schedules),
        selectinload(Palace.segments),
        selectinload(Palace.mini_palaces),
        selectinload(Palace.pegs),
    )


def build_dashboard_payload(
    session: Session,
    *,
    duration_mode: str | None = None,
    month: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    reviews = _dashboard_today_review_groups(session)
    today_start = datetime.combine(date.today(), time.min)
    today_end = today_start + timedelta(days=1)
    recent = (
        session.query(Palace)
        .options(*_dashboard_palace_loader_options())
        .filter(Palace.deleted_at.is_(None))
        .order_by(Palace.updated_at.desc())
        .limit(5)
        .all()
    )
    today_new_palaces = (
        session.query(Palace)
        .options(*_dashboard_palace_loader_options())
        .filter(
            Palace.created_at.is_not(None),
            Palace.created_at >= today_start,
            Palace.created_at < today_end,
            Palace.deleted_at.is_(None),
        )
        .order_by(Palace.created_at.asc(), Palace.id.asc())
        .all()
    )
    review_unit_counts = _dashboard_review_unit_counts(session)
    due_count = review_unit_counts["due_now_count"]
    due_later_today_count = review_unit_counts["due_later_today_count"]
    needs_practice_count = review_unit_counts["needs_practice_count"]

    current_month_start, current_month_end = current_month_bounds()
    current_week_start, current_week_end = current_week_bounds()
    today_start, today_end = today_bounds()
    monthly_total_review_duration_seconds = get_study_session_duration_seconds(
        session,
        scenes=STUDY_DASHBOARD_SCENES,
        start=current_month_start,
        end=current_month_end,
    )
    selected_total_review_duration_seconds = _resolve_selected_duration_seconds(
        session,
        duration_mode=duration_mode,
        month=month,
        start_date=start_date,
        end_date=end_date,
        default_seconds=monthly_total_review_duration_seconds,
    )
    weekly_formal_review_duration_seconds = get_study_session_duration_seconds(
        session,
        scenes=FORMAL_REVIEW_SCENES,
        start=current_week_start,
        end=current_week_end,
    )

    return {
        "due_count": due_count,
        "due_later_today_count": due_later_today_count,
        "needs_practice_count": needs_practice_count,
        "reviews": [
            {
                "id": review["schedule"].id,
                "palace_id": review["schedule"].palace_id,
                "palace": _palace_summary(review["palace"])
                if review.get("palace")
                else None,
                "scheduled_date": review["schedule"].scheduled_date.isoformat(),
                "interval_days": review["schedule"].interval_days,
                "algorithm_used": review["schedule"].algorithm_used,
                "review_number": review["schedule"].review_number,
                "completed": review["schedule"].completed,
                "schedule_count": review["schedule_count"],
                "overdue_schedule_count": review["overdue_schedule_count"],
                "next_due_date": review["next_due_date"].isoformat(),
            }
            for review in reviews
        ],
        "stats": get_weekly_stats(session),
        "today_review_duration_seconds": get_study_session_duration_seconds(
            session,
            scenes=FORMAL_REVIEW_SCENES,
            start=today_start,
            end=today_end,
        ),
        "weekly_review_duration_seconds": weekly_formal_review_duration_seconds,
        "today_total_review_duration_seconds": get_study_session_duration_seconds(
            session,
            scenes=STUDY_DASHBOARD_SCENES,
            start=today_start,
            end=today_end,
        ),
        "monthly_total_review_duration_seconds": monthly_total_review_duration_seconds,
        "selected_total_review_duration_seconds": selected_total_review_duration_seconds,
        "weekly_total_review_duration_seconds": get_study_session_duration_seconds(
            session,
            scenes=STUDY_DASHBOARD_SCENES,
            start=current_week_start,
            end=current_week_end,
        ),
        "weekly_formal_review_duration_seconds": weekly_formal_review_duration_seconds,
        "english_stats": get_english_study_stats(session),
        "recent_palaces": [_palace_summary(palace) for palace in recent],
        "today_learning_palaces": get_today_palace_learning_breakdown(session),
        "today_new_palace_count": len(today_new_palaces),
        "today_new_palaces": build_today_new_palace_outline(session, today_new_palaces),
    }


def _palace_summary(palace: Palace) -> dict:
    return {
        "id": palace.id,
        "title": palace.title,
        "description": palace.description,
        "peg_count": len(palace.pegs),
        "created_at": palace.created_at.isoformat() if palace.created_at else None,
    }


def _dashboard_review_unit_counts(session: Session, now: datetime | None = None) -> dict[str, int]:
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
            Palace.deleted_at.is_(None),
        )
        .subquery()
    )
    schedule_rows = (
        session.query(ReviewSchedule, Palace)
        .join(Palace, Palace.id == ReviewSchedule.palace_id)
        .join(next_schedule_ids, next_schedule_ids.c.schedule_id == ReviewSchedule.id)
        .filter(
            next_schedule_ids.c.position == 1,
            Palace.deleted_at.is_(None),
            (
                (ReviewSchedule.scheduled_date <= today)
                | (ReviewSchedule.scheduled_at < tomorrow_start)
            ),
        )
        .order_by(
            ReviewSchedule.palace_id.asc(),
            ReviewSchedule.review_number.asc(),
            ReviewSchedule.id.asc(),
        )
        .all()
    )
    due_now_count = 0
    due_later_today_count = 0
    policy = load_review_schedule_policy(session)
    for schedule, palace in schedule_rows:
        due_at = schedule_display_datetime_for_policy(
            policy,
            scheduled_date=schedule.scheduled_date,
            scheduled_at=schedule.scheduled_at,
            review_type=schedule.review_type,
            anchor_datetime=palace.created_at or palace.updated_at,
        )
        if due_at and due_at <= current:
            due_now_count += 1
            continue
        if due_at and due_at > current and due_at.date() == today:
            due_later_today_count += 1

    palace_needs_practice = (
        session.query(func.count(Palace.id))
        .filter(
            Palace.needs_practice == True,
            Palace.deleted_at.is_(None),
        )
        .scalar()
        or 0
    )
    mini_palace_needs_practice = (
        session.query(func.count(PalaceMiniPalace.id))
        .join(Palace, Palace.id == PalaceMiniPalace.palace_id)
        .filter(
            PalaceMiniPalace.needs_practice == True,
            Palace.deleted_at.is_(None),
        )
        .scalar()
        or 0
    )
    return {
        "due_now_count": due_now_count,
        "due_later_today_count": due_later_today_count,
        "needs_practice_count": int(palace_needs_practice) + int(mini_palace_needs_practice),
    }


def _dashboard_today_review_groups(
    session: Session,
    *,
    now: datetime | None = None,
    respect_daily_limit: bool = True,
) -> list[dict]:
    current = now or datetime.now()
    today = current.date()
    policy = load_review_schedule_policy(session)
    daily_limit = int(_dashboard_config_value(session, "daily_max_reviews") or "0")
    candidate_schedules = (
        session.query(ReviewSchedule)
        .join(Palace, Palace.id == ReviewSchedule.palace_id)
        .options(joinedload(ReviewSchedule.palace).selectinload(Palace.pegs))
        .filter(
            ReviewSchedule.completed == False,
            Palace.mastered == False,
            Palace.archived == False,
            Palace.deleted_at.is_(None),
            or_(
                ReviewSchedule.scheduled_date <= today,
                ReviewSchedule.scheduled_at <= current,
            ),
        )
        .order_by(
            ReviewSchedule.scheduled_date.asc(),
            ReviewSchedule.review_number.asc(),
            ReviewSchedule.id.asc(),
        )
        .all()
    )

    grouped: OrderedDict[int, dict] = OrderedDict()
    for schedule in candidate_schedules:
        palace = schedule.palace
        if palace is None:
            continue
        due_at = schedule_display_datetime_for_policy(
            policy,
            scheduled_date=schedule.scheduled_date,
            scheduled_at=schedule.scheduled_at,
            review_type=schedule.review_type,
            anchor_datetime=palace.created_at or palace.updated_at,
        )
        if due_at is None or due_at > current:
            continue

        palace_id = int(schedule.palace_id)
        group = grouped.get(palace_id)
        if group is None:
            if respect_daily_limit and daily_limit > 0 and len(grouped) >= daily_limit:
                continue
            group = {
                "schedule": schedule,
                "palace": palace,
                "schedule_count": 0,
                "overdue_schedule_count": 0,
                "next_due_date": schedule.scheduled_date,
            }
            grouped[palace_id] = group

        group["schedule_count"] += 1
        if due_at.date() < today and due_at <= current:
            group["overdue_schedule_count"] += 1
        if schedule.scheduled_date < group["next_due_date"]:
            group["next_due_date"] = schedule.scheduled_date
            group["schedule"] = schedule
    return list(grouped.values())


def _dashboard_config_value(session: Session, key: str) -> str:
    from memory_anki.core.config import DEFAULTS
    from memory_anki.infrastructure.db._tables.misc import Config

    with session.no_autoflush:
        row = session.query(Config).filter_by(key=key).first()
    if row:
        return row.value
    return DEFAULTS.get(key, "")


def _resolve_selected_duration_seconds(
    session: Session,
    *,
    duration_mode: str | None,
    month: str | None,
    start_date: str | None,
    end_date: str | None,
    default_seconds: int,
) -> int:
    if duration_mode is None:
        return default_seconds
    if duration_mode == "month":
        if not month:
            raise DashboardQueryError("month 为必填，格式必须是 YYYY-MM。")
        try:
            selected_month = date.fromisoformat(f"{month}-01")
        except ValueError as error:
            raise DashboardQueryError("month 格式必须是 YYYY-MM。") from error
        selected_start, selected_end = month_bounds(selected_month)
        return get_study_session_duration_seconds(
            session,
            scenes=STUDY_DASHBOARD_SCENES,
            start=selected_start,
            end=selected_end,
        )
    if duration_mode == "range":
        if not start_date or not end_date:
            raise DashboardQueryError("start_date 和 end_date 为必填，格式必须是 YYYY-MM-DD。")
        try:
            selected_start_date = date.fromisoformat(start_date)
            selected_end_date = date.fromisoformat(end_date)
        except ValueError as error:
            raise DashboardQueryError(
                "start_date 和 end_date 格式必须是 YYYY-MM-DD。"
            ) from error
        if selected_start_date > selected_end_date:
            raise DashboardQueryError("开始日期不能晚于结束日期。")
        selected_start, selected_end = date_range_bounds(
            selected_start_date,
            selected_end_date,
        )
        return get_study_session_duration_seconds(
            session,
            scenes=STUDY_DASHBOARD_SCENES,
            start=selected_start,
            end=selected_end,
        )
    if duration_mode == "all":
        return get_all_time_study_session_duration_seconds(
            session,
            scenes=STUDY_DASHBOARD_SCENES,
        )
    raise DashboardQueryError("duration_mode 仅支持 month、range 或 all。")


def build_weekly_report_payload(session: Session, *, offset_weeks: int = 1) -> dict:
    """计算某一自然周（默认上一周）的学习摘要。offset_weeks=0 表示本周。"""
    from memory_anki.infrastructure.db._tables.palaces import ReviewLog

    safe_offset = max(0, min(int(offset_weeks or 0), 52))
    current_week_start, _current_week_end = current_week_bounds()
    week_start = current_week_start - timedelta(days=7 * safe_offset)
    week_end = week_start + timedelta(days=7)

    study_seconds = get_study_session_duration_seconds(
        session,
        scenes=STUDY_DASHBOARD_SCENES,
        start=week_start,
        end=week_end,
    )
    review_count, average_score = (
        session.query(
            func.count(ReviewLog.id),
            func.avg(func.coalesce(ReviewLog.score, 0)),
        )
        .join(Palace, Palace.id == ReviewLog.palace_id)
        .filter(
            ReviewLog.review_date >= week_start.date(),
            ReviewLog.review_date < week_end.date(),
            Palace.deleted_at.is_(None),
        )
        .one()
    )
    review_count = int(review_count or 0)
    average_score = round(float(average_score or 0), 1) if review_count else 0
    new_palace_count = (
        session.query(func.count(Palace.id))
        .filter(
            Palace.created_at.is_not(None),
            Palace.created_at >= week_start,
            Palace.created_at < week_end,
            Palace.deleted_at.is_(None),
        )
        .scalar()
        or 0
    )
    return {
        "week_start": week_start.date().isoformat(),
        "week_end": (week_end - timedelta(days=1)).date().isoformat(),
        "study_seconds": int(study_seconds or 0),
        "review_count": review_count,
        "average_score": average_score,
        "new_palace_count": int(new_palace_count),
    }
