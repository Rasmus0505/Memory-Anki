from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from memory_anki.infrastructure.db.models import Chapter, Palace, PalaceMiniPalace, ReviewSchedule
from memory_anki.modules.palaces.application.title_sync_service import (
    build_today_new_palace_outline,
)
from memory_anki.modules.reviews.application.review_metrics_service import (
    get_weekly_stats,
)
from memory_anki.modules.reviews.application.review_queue_service import (
    get_today_review_groups,
)
from memory_anki.modules.reviews.application.schedule_policy import (
    load_review_schedule_policy,
    schedule_display_datetime_for_policy,
)
from memory_anki.modules.sessions.application.study_session_service import (
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
    reviews = get_today_review_groups(session)
    today_start = datetime.combine(date.today(), time.min)
    today_end = today_start + timedelta(days=1)
    recent = (
        session.query(Palace)
        .options(*_dashboard_palace_loader_options())
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
                "palace": _palace_summary(review["schedule"].palace)
                if review["schedule"].palace
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
        )
        .subquery()
    )
    schedule_rows = (
        session.query(ReviewSchedule, Palace)
        .join(Palace, Palace.id == ReviewSchedule.palace_id)
        .join(next_schedule_ids, next_schedule_ids.c.schedule_id == ReviewSchedule.id)
        .filter(
            next_schedule_ids.c.position == 1,
            (
                (ReviewSchedule.scheduled_date <= today)
                | (ReviewSchedule.scheduled_at <= current)
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
        .filter(Palace.needs_practice == True)
        .scalar()
        or 0
    )
    mini_palace_needs_practice = (
        session.query(func.count(PalaceMiniPalace.id))
        .filter(PalaceMiniPalace.needs_practice == True)
        .scalar()
        or 0
    )
    return {
        "due_now_count": due_now_count,
        "due_later_today_count": due_later_today_count,
        "needs_practice_count": int(palace_needs_practice) + int(mini_palace_needs_practice),
    }


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
