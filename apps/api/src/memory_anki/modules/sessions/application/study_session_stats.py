from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace

from .study_session_constants import (
    ENGLISH_READING_SCENES,
    ENGLISH_SCENES,
    FORMAL_REVIEW_SCENES,
    STUDY_DASHBOARD_SCENES,
)
from .time_bounds import current_week_bounds, today_bounds


def get_study_session_duration_seconds(
    session: Session,
    *,
    scenes: tuple[str, ...],
    start: datetime,
    end: datetime,
) -> int:
    total = (
        session.query(_positive_effective_seconds_sum())
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.status == "completed",
            StudySession.scene.in_(scenes),
            StudySession.started_at >= start,
            StudySession.started_at < end,
        )
        .scalar()
    )
    return int(total or 0)


def get_all_time_study_session_duration_seconds(
    session: Session,
    *,
    scenes: tuple[str, ...],
) -> int:
    total = (
        session.query(_positive_effective_seconds_sum())
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.status == "completed",
            StudySession.scene.in_(scenes),
        )
        .scalar()
    )
    return int(total or 0)


def _positive_effective_seconds_sum():
    return func.coalesce(
        func.sum(
            case(
                (StudySession.effective_seconds > 0, StudySession.effective_seconds),
                else_=0,
            )
        ),
        0,
    )


def get_today_palace_learning_breakdown(session: Session) -> list[dict[str, Any]]:
    start, end = today_bounds()
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.status == "completed",
            StudySession.scene.in_(STUDY_DASHBOARD_SCENES),
            StudySession.palace_id.is_not(None),
            StudySession.started_at >= start,
            StudySession.started_at < end,
        )
        .order_by(StudySession.started_at.asc(), StudySession.id.asc())
        .all()
    )
    palace_ids = {int(row.palace_id) for row in rows if row.palace_id is not None}
    palace_rows = session.query(Palace).filter(Palace.id.in_(palace_ids)).all() if palace_ids else []
    palace_titles = {int(row.id): row.title or "未命名宫殿" for row in palace_rows}
    grouped: dict[int, dict[str, Any]] = {}
    for row in rows:
        if row.palace_id is None:
            continue
        palace_id = int(row.palace_id)
        payload = grouped.setdefault(
            palace_id,
            {
                "palace_id": palace_id,
                "palace_title": palace_titles.get(palace_id) or row.title or "未命名宫殿",
                "total_seconds": 0,
                "review_seconds": 0,
                "practice_seconds": 0,
                "quiz_seconds": 0,
                "palace_edit_seconds": 0,
            },
        )
        seconds = max(0, int(row.effective_seconds or 0))
        payload["total_seconds"] += seconds
        if row.scene in FORMAL_REVIEW_SCENES:
            payload["review_seconds"] += seconds
        elif row.scene == "quiz":
            payload["quiz_seconds"] += seconds
        elif row.scene == "palace_edit":
            payload["palace_edit_seconds"] += seconds
        else:
            payload["practice_seconds"] += seconds
    return sorted(grouped.values(), key=lambda item: (-int(item["total_seconds"]), str(item["palace_title"])))


def build_study_session_stats(session: Session) -> dict[str, int]:
    today_start, today_end = today_bounds()
    week_start, week_end = current_week_bounds()
    return {
        "today_total_seconds": get_study_session_duration_seconds(
            session, scenes=STUDY_DASHBOARD_SCENES, start=today_start, end=today_end
        ),
        "weekly_total_seconds": get_study_session_duration_seconds(
            session, scenes=STUDY_DASHBOARD_SCENES, start=week_start, end=week_end
        ),
        "today_review_seconds": get_study_session_duration_seconds(
            session, scenes=FORMAL_REVIEW_SCENES, start=today_start, end=today_end
        ),
        "weekly_review_seconds": get_study_session_duration_seconds(
            session, scenes=FORMAL_REVIEW_SCENES, start=week_start, end=week_end
        ),
    }


def get_english_study_stats(session: Session) -> dict[str, int]:
    from memory_anki.infrastructure.db._tables.english import EnglishCourse, EnglishCourseProgress

    today_start, today_end = today_bounds()
    week_start, week_end = current_week_bounds()
    today_practice_seconds = get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_SCENES,
        start=today_start,
        end=today_end,
    )
    weekly_practice_seconds = get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_SCENES,
        start=week_start,
        end=week_end,
    )
    total_practice_seconds = get_all_time_study_session_duration_seconds(
        session,
        scenes=ENGLISH_SCENES,
    )
    today_reading_seconds = get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_READING_SCENES,
        start=today_start,
        end=today_end,
    )
    weekly_reading_seconds = get_study_session_duration_seconds(
        session,
        scenes=ENGLISH_READING_SCENES,
        start=week_start,
        end=week_end,
    )
    total_reading_seconds = get_all_time_study_session_duration_seconds(
        session,
        scenes=ENGLISH_READING_SCENES,
    )
    total_courses = session.query(EnglishCourse).count()
    completed_courses = (
        session.query(EnglishCourseProgress)
        .filter(EnglishCourseProgress.is_completed.is_(True))
        .count()
    )
    return {
        "total_courses": total_courses,
        "unfinished_courses": max(0, total_courses - completed_courses),
        "completed_courses": completed_courses,
        "today_practice_seconds": today_practice_seconds,
        "weekly_practice_seconds": weekly_practice_seconds,
        "total_practice_seconds": total_practice_seconds,
        "today_reading_seconds": today_reading_seconds,
        "weekly_reading_seconds": weekly_reading_seconds,
        "total_reading_seconds": total_reading_seconds,
        "today_total_seconds": today_practice_seconds + today_reading_seconds,
        "weekly_total_seconds": weekly_practice_seconds + weekly_reading_seconds,
        "total_seconds": total_practice_seconds + total_reading_seconds,
    }
