from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace

from .study_session_constants import (
    BUILTIN_TIME_RECORD_KINDS,
    ENGLISH_READING_SCENES,
    ENGLISH_SCENES,
    FORMAL_REVIEW_SCENES,
    STUDY_DASHBOARD_SCENES,
    TIME_RECORD_KIND_LABELS,
)
from .time_bounds import current_week_bounds, today_bounds


def get_study_session_duration_seconds(
    session: Session,
    *,
    scenes: tuple[str, ...],
    start: datetime,
    end: datetime,
) -> int:
    """Sum completed session seconds whose completion day falls in [start, end).

    Attribution uses ``ended_at`` (with ``started_at`` fallback) so multi-day
    recovered formal reviews count on the day they actually finished.
    """
    attributed_at = _session_attribution_at()
    total = (
        session.query(_positive_effective_seconds_sum())
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.status == "completed",
            StudySession.scene.in_(scenes),
            attributed_at >= start,
            attributed_at < end,
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


def _session_attribution_at():
    """When a completed session counts toward daily/weekly stats."""
    return func.coalesce(StudySession.ended_at, StudySession.started_at)


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
    attributed_at = _session_attribution_at()
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.deleted_at.is_(None),
            StudySession.status == "completed",
            StudySession.scene.in_(STUDY_DASHBOARD_SCENES),
            StudySession.palace_id.is_not(None),
            attributed_at >= start,
            attributed_at < end,
        )
        .order_by(attributed_at.asc(), StudySession.id.asc())
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


def build_time_record_analytics(
    session: Session,
    *,
    trend_range: int | str,
    breakdown_range: int | str,
    reference_date: date | None = None,
) -> dict[str, list[dict[str, Any]]]:
    today = reference_date or date.today()
    tomorrow = datetime.combine(today + timedelta(days=1), time.min)
    return {
        "trend": _build_time_record_trend(
            session,
            range_value=trend_range,
            today=today,
            tomorrow=tomorrow,
        ),
        "breakdown": _build_time_record_breakdown(
            session,
            range_value=breakdown_range,
            today=today,
            tomorrow=tomorrow,
        ),
    }


def _range_start(
    session: Session,
    *,
    range_value: int | str,
    today: date,
) -> date:
    if range_value != "all":
        return today - timedelta(days=max(1, int(range_value)) - 1)
    attributed_at = _session_attribution_at()
    earliest = (
        session.query(func.min(attributed_at))
        .filter(StudySession.deleted_at.is_(None))
        .scalar()
    )
    return earliest.date() if earliest is not None else today


def _build_time_record_trend(
    session: Session,
    *,
    range_value: int | str,
    today: date,
    tomorrow: datetime,
) -> list[dict[str, Any]]:
    start_date = _range_start(session, range_value=range_value, today=today)
    start = datetime.combine(start_date, time.min)
    attributed_at = _session_attribution_at()
    rows = (
        session.query(
            func.date(attributed_at),
            func.coalesce(func.sum(StudySession.effective_seconds), 0),
        )
        .filter(
            StudySession.deleted_at.is_(None),
            attributed_at >= start,
            attributed_at < tomorrow,
        )
        .group_by(func.date(attributed_at))
        .all()
    )
    totals = {str(date_key): int(seconds or 0) for date_key, seconds in rows}
    days = max(1, (today - start_date).days + 1)
    result: list[dict[str, Any]] = []
    for index in range(days):
        current = start_date + timedelta(days=index)
        date_key = current.isoformat()
        result.append(
            {
                "date_key": date_key,
                "label": f"{current.month}/{current.day}",
                "seconds": totals.get(date_key, 0),
            }
        )
    return result


def _build_time_record_breakdown(
    session: Session,
    *,
    range_value: int | str,
    today: date,
    tomorrow: datetime,
) -> list[dict[str, Any]]:
    start_date = _range_start(session, range_value=range_value, today=today)
    attributed_at = _session_attribution_at()
    rows = (
        session.query(StudySession)
        .filter(
            StudySession.deleted_at.is_(None),
            attributed_at >= datetime.combine(start_date, time.min),
            attributed_at < tomorrow,
        )
        .all()
    )
    totals: dict[str, dict[str, Any]] = {
        kind: {
            "kind": kind,
            "label": TIME_RECORD_KIND_LABELS[kind],
            "seconds": 0,
            "sessions": 0,
            "is_builtin": True,
        }
        for kind in BUILTIN_TIME_RECORD_KINDS
    }
    for row in rows:
        seconds = max(0, int(row.effective_seconds or 0))
        key, label, is_builtin = _breakdown_key_for_session(row)
        current = totals.get(key)
        if current is None:
            current = {
                "kind": key,
                "label": label,
                "seconds": 0,
                "sessions": 0,
                "is_builtin": is_builtin,
            }
            totals[key] = current
        current["seconds"] += seconds
        current["sessions"] += 1
        if label and current["label"] != label and not current["is_builtin"]:
            current["label"] = label

    builtin_items = [totals[kind] for kind in BUILTIN_TIME_RECORD_KINDS]
    custom_items = sorted(
        (
            item
            for key, item in totals.items()
            if key not in BUILTIN_TIME_RECORD_KINDS
        ),
        key=lambda item: (-int(item["seconds"]), str(item["label"])),
    )
    return [
        {
            "kind": item["kind"],
            "label": item["label"],
            "seconds": int(item["seconds"]),
            "sessions": int(item["sessions"]),
            "is_builtin": bool(item["is_builtin"]),
        }
        for item in [*builtin_items, *custom_items]
    ]


def _breakdown_key_for_session(row: StudySession) -> tuple[str, str, bool]:
    summary = _load_summary(row.summary_json)
    activity_tag = str(summary.get("activity_tag") or "").strip()
    activity_label = str(summary.get("activity_tag_label") or "").strip()
    scene = str(row.scene or "")
    kind = _time_record_kind(scene)

    if activity_tag and activity_tag not in BUILTIN_TIME_RECORD_KINDS:
        return activity_tag, activity_label or activity_tag, False
    if scene == "custom":
        return (
            activity_tag or "custom",
            activity_label or TIME_RECORD_KIND_LABELS["custom"],
            False,
        )
    if activity_tag in BUILTIN_TIME_RECORD_KINDS:
        return activity_tag, TIME_RECORD_KIND_LABELS[activity_tag], True
    return kind, TIME_RECORD_KIND_LABELS[kind], True


def _load_summary(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _time_record_kind(scene: str) -> str:
    if scene == "palace_edit":
        return "palace_edit"
    if scene == "quiz":
        return "quiz"
    if scene in FORMAL_REVIEW_SCENES:
        return "review"
    if scene == "custom":
        return "custom"
    return "practice"


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
