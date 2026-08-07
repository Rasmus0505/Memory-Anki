from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import String, and_, cast, func, or_
from sqlalchemy.orm import Query, Session
from sqlalchemy.sql.elements import ColumnElement

from memory_anki.core.time import local_calendar_day_start_as_utc_naive
from memory_anki.infrastructure.db._tables.misc import StudySession

from .serialization import study_session_json
from .time_bounds import date_range_bounds, month_bounds, today_bounds

TimeRecordRangeMode = Literal["today", "month", "rolling", "custom", "all"]
TimeRecordKind = Literal[
    "review",
    "practice",
    "quiz",
    "palace_edit",
    "english",
    "english_reading",
    "custom",
]

TIME_RECORD_REVIEW_SCENES = (
    "review",
    "formal_unit_review",
    "freestyle_unit_review",
    "segment_review",
    "mini_review",
)
TIME_RECORD_BUILTIN_KINDS = (
    "review",
    "practice",
    "quiz",
    "palace_edit",
    "english",
    "english_reading",
)
TIME_RECORD_KIND_LABELS = {
    "review": "正式复习",
    "practice": "练习",
    "quiz": "做题",
    "palace_edit": "宫殿编辑",
    "english": "英语",
    "english_reading": "英语阅读",
    "custom": "其他",
}


class TimeRecordQueryError(ValueError):
    pass


@dataclass(frozen=True)
class ResolvedTimeRecordRange:
    mode: TimeRecordRangeMode
    start: datetime | None
    end: datetime | None
    start_date: date | None
    end_date: date | None
    month: str | None = None
    rolling_days: int | None = None

    def payload(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "month": self.month,
            "rolling_days": self.rolling_days,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
        }


def resolve_time_record_range(
    *,
    range_mode: str = "month",
    month: str | None = None,
    rolling_days: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    reference_date: date | None = None,
) -> ResolvedTimeRecordRange:
    today = reference_date or date.today()
    mode = str(range_mode or "month").strip().lower()
    if mode == "all":
        return ResolvedTimeRecordRange("all", None, None, None, None)
    if mode == "today":
        start, end = today_bounds() if reference_date is None else date_range_bounds(today, today)
        return ResolvedTimeRecordRange("today", start, end, today, today)
    if mode == "rolling":
        days = int(rolling_days or 7)
        if days not in {7, 30, 90}:
            raise TimeRecordQueryError("rolling_days must be one of 7, 30, or 90")
        first_day = today - timedelta(days=days - 1)
        start, end = date_range_bounds(first_day, today)
        return ResolvedTimeRecordRange(
            "rolling", start, end, first_day, today, rolling_days=days
        )
    if mode == "custom":
        if not start_date or not end_date:
            raise TimeRecordQueryError("custom range requires start_date and end_date")
        try:
            first_day = date.fromisoformat(str(start_date)[:10])
            last_day = date.fromisoformat(str(end_date)[:10])
        except ValueError as exc:
            raise TimeRecordQueryError("start_date and end_date must be YYYY-MM-DD") from exc
        if first_day > last_day:
            raise TimeRecordQueryError("start_date must not be after end_date")
        start, end = date_range_bounds(first_day, last_day)
        return ResolvedTimeRecordRange("custom", start, end, first_day, last_day)
    if mode != "month":
        raise TimeRecordQueryError("range_mode must be today, month, rolling, custom, or all")
    month_value = str(month or f"{today.year:04d}-{today.month:02d}")
    try:
        year_value, month_number = month_value.split("-", 1)
        first_day = date(int(year_value), int(month_number), 1)
    except (TypeError, ValueError) as exc:
        raise TimeRecordQueryError("month must be YYYY-MM") from exc
    start, end = month_bounds(first_day)
    next_month = (
        date(first_day.year + 1, 1, 1)
        if first_day.month == 12
        else date(first_day.year, first_day.month + 1, 1)
    )
    last_day = next_month - timedelta(days=1)
    return ResolvedTimeRecordRange(
        "month", start, end, first_day, last_day, month=month_value
    )


def time_record_attributed_at():
    return func.coalesce(StudySession.ended_at, StudySession.started_at)


def _summary_json_value(path: str):
    return func.json_extract(StudySession.summary_json, path)


def _normalized_activity_tag():
    return func.trim(
        func.coalesce(cast(_summary_json_value("$.activity_tag"), String), "")
    )


def valid_time_records_query(
    session: Session,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    keyword: str | None = None,
    kind: str | None = None,
) -> Query:
    attributed_at = time_record_attributed_at()
    query = session.query(StudySession).filter(
        StudySession.deleted_at.is_(None),
        StudySession.status == "completed",
        StudySession.effective_seconds > 0,
    )
    if start is not None:
        query = query.filter(attributed_at >= start)
    if end is not None:
        query = query.filter(attributed_at < end)
    normalized_keyword = str(keyword or "").strip()
    if normalized_keyword:
        query = query.filter(StudySession.title.ilike(f"%{normalized_keyword}%"))
    return _apply_time_record_kind_filter(query, kind)


def _apply_time_record_kind_filter(query: Query, kind: str | None) -> Query:
    normalized = str(kind or "").strip()
    if not normalized:
        return query
    if normalized not in (*TIME_RECORD_BUILTIN_KINDS, "custom"):
        raise TimeRecordQueryError(f"unsupported time-record kind: {normalized}")

    activity_tag = _normalized_activity_tag()
    scene_fallback_allowed = or_(activity_tag == "", activity_tag == "custom")
    custom_activity_tag = and_(
        activity_tag != "",
        activity_tag.notin_((*TIME_RECORD_BUILTIN_KINDS, "custom")),
    )
    if normalized == "custom":
        return query.filter(
            or_(
                custom_activity_tag,
                and_(scene_fallback_allowed, StudySession.scene == "custom"),
            )
        )

    scene_matches: ColumnElement[bool]
    if normalized == "review":
        scene_matches = StudySession.scene.in_(TIME_RECORD_REVIEW_SCENES)
    elif normalized == "practice":
        scene_matches = StudySession.scene.notin_(
            (
                *TIME_RECORD_REVIEW_SCENES,
                "quiz",
                "palace_edit",
                "english",
                "english_reading",
                "custom",
            )
        )
    else:
        scene_matches = StudySession.scene == normalized
    return query.filter(
        or_(
            activity_tag == normalized,
            and_(scene_fallback_allowed, scene_matches),
        )
    )


def _load_summary(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def time_record_kind(scene: str | None, summary_json: str | None = None) -> tuple[str, str, bool]:
    summary = _load_summary(summary_json)
    activity_tag = str(summary.get("activity_tag") or "").strip()
    activity_label = str(summary.get("activity_tag_label") or "").strip()
    normalized_scene = str(scene or "")
    if activity_tag and activity_tag not in (*TIME_RECORD_BUILTIN_KINDS, "custom"):
        return activity_tag, activity_label or activity_tag, False
    if normalized_scene == "custom":
        return (
            activity_tag or "custom",
            activity_label or TIME_RECORD_KIND_LABELS["custom"],
            False,
        )
    if activity_tag in TIME_RECORD_BUILTIN_KINDS:
        return activity_tag, TIME_RECORD_KIND_LABELS[activity_tag], True
    if normalized_scene in TIME_RECORD_REVIEW_SCENES:
        kind = "review"
    elif normalized_scene == "quiz":
        kind = "quiz"
    elif normalized_scene == "palace_edit":
        kind = "palace_edit"
    elif normalized_scene == "english":
        kind = "english"
    elif normalized_scene == "english_reading":
        kind = "english_reading"
    else:
        kind = "practice"
    return kind, TIME_RECORD_KIND_LABELS[kind], True


def _client_source(summary_json: str | None) -> str:
    value = str(_load_summary(summary_json).get("client_source") or "").strip().lower()
    if value == "desktop":
        return "desktop"
    if value in {"pwa", "mobile"}:
        return "pwa"
    return "unknown"


def _to_local_date(value: datetime) -> date:
    aware = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return aware.astimezone().date()


def build_time_record_read_model(
    session: Session,
    *,
    range_mode: str = "month",
    month: str | None = None,
    rolling_days: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    keyword: str | None = None,
    kind: str | None = None,
    sort_by: str = "started_at",
    sort_order: str = "desc",
    limit: int = 20,
    offset: int = 0,
    reference_date: date | None = None,
) -> dict[str, Any]:
    resolved = resolve_time_record_range(
        range_mode=range_mode,
        month=month,
        rolling_days=rolling_days,
        start_date=start_date,
        end_date=end_date,
        reference_date=reference_date,
    )
    base = valid_time_records_query(
        session,
        start=resolved.start,
        end=resolved.end,
        keyword=keyword,
        kind=kind,
    )
    aggregate_rows = base.with_entities(
        StudySession.scene,
        StudySession.effective_seconds,
        StudySession.summary_json,
    ).all()
    source_totals = {"desktop": 0, "pwa": 0, "unknown": 0}
    kind_totals: dict[str, dict[str, Any]] = {
        kind_key: {
            "kind": kind_key,
            "label": TIME_RECORD_KIND_LABELS[kind_key],
            "seconds": 0,
            "sessions": 0,
            "is_builtin": True,
        }
        for kind_key in TIME_RECORD_BUILTIN_KINDS
    }
    total_seconds = 0
    for scene, effective_seconds, summary_json in aggregate_rows:
        seconds = max(0, int(effective_seconds or 0))
        total_seconds += seconds
        source_totals[_client_source(summary_json)] += seconds
        kind_key, label, is_builtin = time_record_kind(scene, summary_json)
        item = kind_totals.setdefault(
            kind_key,
            {
                "kind": kind_key,
                "label": label,
                "seconds": 0,
                "sessions": 0,
                "is_builtin": is_builtin,
            },
        )
        item["seconds"] += seconds
        item["sessions"] += 1
    breakdown = sorted(
        kind_totals.values(),
        key=lambda item: (
            0 if item["kind"] in TIME_RECORD_BUILTIN_KINDS else 1,
            TIME_RECORD_BUILTIN_KINDS.index(item["kind"])
            if item["kind"] in TIME_RECORD_BUILTIN_KINDS
            else -int(item["seconds"]),
            str(item["label"]),
        ),
    )

    attributed_at = time_record_attributed_at()
    local_day = func.date(attributed_at, "localtime")
    trend_rows = (
        base.with_entities(
            local_day,
            func.coalesce(func.sum(StudySession.effective_seconds), 0),
            func.count(StudySession.id),
        )
        .group_by(local_day)
        .all()
    )
    daily = {
        str(day_key): {"seconds": int(seconds or 0), "records": int(records or 0)}
        for day_key, seconds, records in trend_rows
        if day_key is not None
    }
    first_day = resolved.start_date
    last_day = resolved.end_date
    if resolved.mode == "all":
        earliest = base.with_entities(func.min(attributed_at)).scalar()
        latest = base.with_entities(func.max(attributed_at)).scalar()
        today = reference_date or date.today()
        first_day = _to_local_date(earliest) if earliest else today
        last_day = max(today, _to_local_date(latest)) if latest else today
    if first_day is None or last_day is None:
        first_day = last_day = reference_date or date.today()
    trend: list[dict[str, Any]] = []
    for index in range(max(1, (last_day - first_day).days + 1)):
        current = first_day + timedelta(days=index)
        values = daily.get(current.isoformat(), {"seconds": 0, "records": 0})
        trend.append(
            {
                "date_key": current.isoformat(),
                "label": f"{current.month}/{current.day}",
                "seconds": int(values["seconds"]),
                "records": int(values["records"]),
            }
        )

    sort_column = {
        "started_at": StudySession.started_at,
        "effective_seconds": StudySession.effective_seconds,
        "title": func.lower(StudySession.title),
    }.get(sort_by)
    if sort_column is None:
        raise TimeRecordQueryError("unsupported sort_by")
    if sort_order not in {"asc", "desc"}:
        raise TimeRecordQueryError("unsupported sort_order")
    order = sort_column.asc() if sort_order == "asc" else sort_column.desc()
    safe_limit = max(1, min(int(limit), 500))
    safe_offset = max(0, int(offset))
    item_rows = (
        base.order_by(order, StudySession.id.asc())
        .offset(safe_offset)
        .limit(safe_limit)
        .all()
    )
    summary = {
        "record_count": len(aggregate_rows),
        "total_effective_seconds": total_seconds,
        "desktop_effective_seconds": source_totals["desktop"],
        "pwa_effective_seconds": source_totals["pwa"],
        "unknown_effective_seconds": source_totals["unknown"],
    }
    return {
        "items": [study_session_json(row) for row in item_rows],
        "total": len(aggregate_rows),
        "limit": safe_limit,
        "offset": safe_offset,
        "range": resolved.payload(),
        "summary": summary,
        "kind_breakdown": [
            {
                "kind": str(item["kind"]),
                "label": str(item["label"]),
                "seconds": int(item["seconds"]),
                "sessions": int(item["sessions"]),
                "is_builtin": bool(item["is_builtin"]),
            }
            for item in breakdown
        ],
        "trend": trend,
    }


def get_time_record_duration_seconds(
    session: Session,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    kind: str | None = None,
) -> int:
    total = (
        valid_time_records_query(session, start=start, end=end, kind=kind)
        .with_entities(func.coalesce(func.sum(StudySession.effective_seconds), 0))
        .scalar()
    )
    return int(total or 0)


def count_time_records(
    session: Session,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    kind: str | None = None,
) -> int:
    return valid_time_records_query(session, start=start, end=end, kind=kind).count()


def get_time_record_daily_totals(
    session: Session,
    *,
    start: datetime,
    end: datetime,
    kind: str | None = None,
) -> list[tuple[str, int, int]]:
    attributed_at = time_record_attributed_at()
    local_day = func.date(attributed_at, "localtime")
    rows = (
        valid_time_records_query(session, start=start, end=end, kind=kind)
        .with_entities(
            local_day,
            func.coalesce(func.sum(StudySession.effective_seconds), 0),
            func.count(StudySession.id),
        )
        .group_by(local_day)
        .all()
    )
    return [
        (str(day_key), int(seconds or 0), int(records or 0))
        for day_key, seconds, records in rows
        if day_key is not None
    ]


def local_date_range_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    return (
        local_calendar_day_start_as_utc_naive(start_date),
        local_calendar_day_start_as_utc_naive(end_date + timedelta(days=1)),
    )
