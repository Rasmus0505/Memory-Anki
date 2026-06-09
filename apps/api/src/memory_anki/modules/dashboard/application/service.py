from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Palace
from memory_anki.modules.palaces.application.title_sync_service import (
    build_today_new_palace_outline,
    palace_has_due_later_today,
)
from memory_anki.modules.reviews.application.review_metrics_service import (
    get_weekly_stats,
)
from memory_anki.modules.reviews.application.review_queue_service import (
    get_today_review_groups,
)
from memory_anki.modules.time_records.application.time_records_service import (
    date_range_bounds,
    get_all_time_total_review_duration_seconds,
    get_english_course_stats,
    get_monthly_total_review_duration_seconds,
    get_selected_total_review_duration_seconds,
    get_today_formal_review_duration_seconds,
    get_today_palace_learning_breakdown,
    get_today_total_review_duration_seconds,
    get_weekly_formal_review_duration_seconds,
    get_weekly_total_review_duration_seconds,
    month_bounds,
)


class DashboardQueryError(ValueError):
    pass


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
    recent = session.query(Palace).order_by(Palace.updated_at.desc()).limit(5).all()
    today_new_palaces = (
        session.query(Palace)
        .filter(
            Palace.created_at.is_not(None),
            Palace.created_at >= today_start,
            Palace.created_at < today_end,
        )
        .order_by(Palace.created_at.asc(), Palace.id.asc())
        .all()
    )
    all_palaces = session.query(Palace).all()
    due_palace_ids = {review["schedule"].palace_id for review in reviews}
    due_later_today_count = sum(
        1
        for palace in all_palaces
        if palace.id not in due_palace_ids and palace_has_due_later_today(session, palace)
    )
    needs_practice_count = sum(
        1 for palace in all_palaces if bool(getattr(palace, "needs_practice", False))
    )

    monthly_total_review_duration_seconds = get_monthly_total_review_duration_seconds(session)
    selected_total_review_duration_seconds = _resolve_selected_duration_seconds(
        session,
        duration_mode=duration_mode,
        month=month,
        start_date=start_date,
        end_date=end_date,
        default_seconds=monthly_total_review_duration_seconds,
    )
    weekly_formal_review_duration_seconds = get_weekly_formal_review_duration_seconds(session)

    return {
        "due_count": len(reviews),
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
        "today_review_duration_seconds": get_today_formal_review_duration_seconds(session),
        "weekly_review_duration_seconds": weekly_formal_review_duration_seconds,
        "today_total_review_duration_seconds": get_today_total_review_duration_seconds(session),
        "monthly_total_review_duration_seconds": monthly_total_review_duration_seconds,
        "selected_total_review_duration_seconds": selected_total_review_duration_seconds,
        "weekly_total_review_duration_seconds": get_weekly_total_review_duration_seconds(session),
        "weekly_formal_review_duration_seconds": weekly_formal_review_duration_seconds,
        "english_stats": get_english_course_stats(session),
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
        return get_selected_total_review_duration_seconds(
            session,
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
        return get_selected_total_review_duration_seconds(
            session,
            start=selected_start,
            end=selected_end,
        )
    if duration_mode == "all":
        return get_all_time_total_review_duration_seconds(session)
    raise DashboardQueryError("duration_mode 仅支持 month、range 或 all。")
