from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db._tables.palaces import Palace, Peg, ReviewLog
from memory_anki.modules.content.public.queries import build_today_new_palace_outline
from memory_anki.modules.memory.public.queries import get_fsrs_queue_payload, get_weekly_stats
from memory_anki.modules.session.public.queries import (
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
    )


def _peg_counts_by_palace(session: Session, palace_ids: list[int]) -> dict[int, int]:
    if not palace_ids:
        return {}
    rows = (
        session.query(Peg.palace_id, func.count(Peg.id))
        .filter(Peg.palace_id.in_(palace_ids))
        .group_by(Peg.palace_id)
        .all()
    )
    return {int(palace_id): int(count) for palace_id, count in rows}


def build_dashboard_payload(
    session: Session,
    *,
    duration_mode: str | None = None,
    month: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    queue = get_fsrs_queue_payload(session, include_stats=True, include_items=True)
    today_start, today_end = today_bounds()
    recent = (
        session.query(Palace)
        .options(*_dashboard_palace_loader_options())
        .filter(Palace.deleted_at.is_(None))
        .order_by(Palace.updated_at.desc())
        .limit(5)
        .all()
    )
    peg_counts = _peg_counts_by_palace(session, [palace.id for palace in recent])
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

    current_month_start, current_month_end = current_month_bounds()
    current_week_start, current_week_end = current_week_bounds()
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

    reviews = []
    for item in queue.get("reviews") or []:
        reviews.append(
            {
                "id": item["palace_id"],
                "palace_id": item["palace_id"],
                "palace": item.get("palace"),
                "scheduled_date": item.get("next_due_date") or item.get("scheduled_date"),
                "interval_days": None,
                "algorithm_used": "FSRS",
                "review_number": 0,
                "completed": False,
                "schedule_count": item.get("due_node_count") or 0,
                "overdue_schedule_count": item.get("overdue_node_count") or 0,
                "next_due_date": item.get("next_due_date"),
                "due_node_count": item.get("due_node_count") or 0,
                "overdue_node_count": item.get("overdue_node_count") or 0,
                "review_entry_mode": item.get("review_entry_mode"),
                "review_entry_label": item.get("review_entry_label"),
                "primary_branch_title": item.get("primary_branch_title"),
            }
        )

    return {
        "due_count": int(queue.get("due_count") or 0),
        "due_later_today_count": int(queue.get("later_today_count") or 0),
        "needs_practice_count": 0,
        "reviews": reviews,
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
        "recent_palaces": [
            _palace_summary(palace, peg_count=peg_counts.get(palace.id, 0))
            for palace in recent
        ],
        "today_learning_palaces": get_today_palace_learning_breakdown(session),
        "today_new_palace_count": len(today_new_palaces),
        "today_new_palaces": build_today_new_palace_outline(session, today_new_palaces),
    }


def _palace_summary(palace: Palace, *, peg_count: int = 0) -> dict:
    return {
        "id": palace.id,
        "title": palace.title,
        "description": palace.description,
        "peg_count": int(peg_count),
        "created_at": palace.created_at.isoformat() if palace.created_at else None,
    }


def _dashboard_config_value(session: Session, key: str) -> str | None:
    row = session.query(Config).filter_by(key=key).first()
    return row.value if row else None


def _resolve_selected_duration_seconds(
    session: Session,
    *,
    duration_mode: str | None,
    month: str | None,
    start_date: str | None,
    end_date: str | None,
    default_seconds: int,
) -> int:
    mode = (duration_mode or "month").strip().lower()
    if mode == "all":
        return get_all_time_study_session_duration_seconds(session, scenes=STUDY_DASHBOARD_SCENES)
    if mode == "custom":
        if not start_date or not end_date:
            raise DashboardQueryError("custom duration requires start_date and end_date")
        try:
            custom_start = date.fromisoformat(str(start_date)[:10])
            custom_end = date.fromisoformat(str(end_date)[:10])
        except ValueError as error:
            raise DashboardQueryError("start_date and end_date must be YYYY-MM-DD") from error
        start, end = date_range_bounds(custom_start, custom_end)
        return get_study_session_duration_seconds(
            session, scenes=STUDY_DASHBOARD_SCENES, start=start, end=end
        )
    if mode == "week":
        start, end = current_week_bounds()
        return get_study_session_duration_seconds(
            session, scenes=STUDY_DASHBOARD_SCENES, start=start, end=end
        )
    if mode == "today":
        start, end = today_bounds()
        return get_study_session_duration_seconds(
            session, scenes=STUDY_DASHBOARD_SCENES, start=start, end=end
        )
    if month:
        try:
            year_s, month_s = str(month).split("-", 1)
            target = date(int(year_s), int(month_s), 1)
        except (TypeError, ValueError) as error:
            raise DashboardQueryError("month must be YYYY-MM") from error
        start, end = month_bounds(target)
        return get_study_session_duration_seconds(
            session, scenes=STUDY_DASHBOARD_SCENES, start=start, end=end
        )
    return default_seconds


def build_weekly_report_payload(session: Session, *, offset_weeks: int = 1) -> dict:
    """Summarize one calendar week of study (default: previous week). offset_weeks=0 is current week."""
    safe_offset = max(0, min(int(offset_weeks or 0), 52))
    today = date.today()
    current_week_start_date = today - timedelta(days=today.weekday())
    week_start_date = current_week_start_date - timedelta(days=7 * safe_offset)
    week_end_date = week_start_date + timedelta(days=7)
    week_start, week_end = date_range_bounds(week_start_date, week_end_date - timedelta(days=1))

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
            ReviewLog.review_date >= week_start_date,
            ReviewLog.review_date < week_end_date,
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
        "week_start": week_start_date.isoformat(),
        "week_end": (week_end_date - timedelta(days=1)).isoformat(),
        "study_seconds": int(study_seconds or 0),
        "review_count": review_count,
        "average_score": average_score,
        "new_palace_count": int(new_palace_count),
    }
