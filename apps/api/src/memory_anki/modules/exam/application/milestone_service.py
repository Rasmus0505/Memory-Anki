"""Study milestones: dated checkpoints the learner wants to be reminded about.

Milestones are plan-level markers (book finished, subject round done, exam day),
not scheduling state. They never move a due date and never gate review; they
only answer "what was supposed to be finished by now, and is it?".

Storage is one JSON row so a milestone list can be edited as a whole without a
migration. Ordering is by date, then by the stored id, so the list is stable.
"""

from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.exam_horizon import (
    EXAM_SETTINGS_KEY,
    coerce_exam_date,
    read_exam_settings,
    resolve_sprint_horizon,
)
from memory_anki.core.time import local_day, utc_now_naive
from memory_anki.infrastructure.db._tables.misc import Config

MILESTONES_KEY = "study_milestones"

MAX_MILESTONES = 60
MAX_TITLE_CHARS = 60
MAX_DETAIL_CHARS = 200
MAX_NOTIFY_DAYS = 30
DEFAULT_NOTIFY_DAYS = 3

# Seeded once for a new plan; the learner edits or deletes any of them.
DEFAULT_MILESTONES: tuple[dict[str, Any], ...] = (
    {
        "id": "kaoyan-2027-zhongjiaoshi",
        "date": "2026-10-31",
        "title": "中国教育史完成",
        "category": "333",
        "detail": "33 节全部过完，能闭卷画出「朝代—制度—人物」总框架",
        "notify_days_before": 3,
    },
    {
        "id": "kaoyan-2027-jiaoyuan",
        "date": "2026-11-05",
        "title": "教育学原理完成",
        "category": "333",
        "detail": "9 章框架成体系，每章能写出 3 个可考名词解释或简答要点",
        "notify_days_before": 3,
    },
    {
        "id": "kaoyan-2027-jiaoxin",
        "date": "2026-11-10",
        "title": "教育心理学完成 → 333 收口",
        "category": "333",
        "detail": "23 节过完；三科各画一张总图作为专业课一收口",
        "notify_days_before": 3,
    },
    {
        "id": "kaoyan-2027-zhuanye2-start",
        "date": "2026-11-11",
        "title": "专业课二启动",
        "category": "专业课二",
        "detail": "333 未完成前不打开这两本书",
        "notify_days_before": 1,
    },
    {
        "id": "kaoyan-2027-gailun",
        "date": "2026-11-16",
        "title": "《科学教育与科学传播概论》完成",
        "category": "专业课二",
        "detail": "崔鸿、李秀菊 8 章 / 454 页",
        "notify_days_before": 2,
    },
    {
        "id": "kaoyan-2027-yanjiu",
        "date": "2026-11-19",
        "title": "《科学教育研究方法》完成 → 专业课二完成",
        "category": "专业课二",
        "detail": "董艳 13 章 / 282 页；两本书各建一套框架",
        "notify_days_before": 2,
    },
    {
        "id": "kaoyan-2027-mayuan",
        "date": "2026-10-31",
        "title": "马原 8 宫完成",
        "category": "政治",
        "detail": "每天 1h，按宫殿推进，不按教材页数",
        "notify_days_before": 2,
    },
    {
        "id": "kaoyan-2027-maozhongte",
        "date": "2026-11-05",
        "title": "毛中特 9 宫完成",
        "category": "政治",
        "detail": "",
        "notify_days_before": 2,
    },
    {
        "id": "kaoyan-2027-xisixiang",
        "date": "2026-11-13",
        "title": "习思想 18 宫完成",
        "category": "政治",
        "detail": "政治里宫数最多的一段，注意不要压到最后",
        "notify_days_before": 3,
    },
    {
        "id": "kaoyan-2027-shigang",
        "date": "2026-11-18",
        "title": "史纲 10 宫完成",
        "category": "政治",
        "detail": "",
        "notify_days_before": 2,
    },
    {
        "id": "kaoyan-2027-sixiu",
        "date": "2026-11-20",
        "title": "思修 7 宫完成 → 政治一轮 52 宫完成",
        "category": "政治",
        "detail": "宫殿里没有的时政，11/20 后单独补",
        "notify_days_before": 2,
    },
    {
        "id": "kaoyan-2027-yanshou",
        "date": "2026-11-20",
        "title": "两门专业课总验收",
        "category": "总节点",
        "detail": "333 三科框架 + 专业课二两本框架闭卷总测，错题补漏",
        "notify_days_before": 5,
    },
    {
        "id": "kaoyan-2027-second-round",
        "date": "2026-11-21",
        "title": "二轮启动",
        "category": "总节点",
        "detail": "政治 3h/天、英语 2h/天，专业课二轮 5h",
        "notify_days_before": 1,
    },
    {
        "id": "kaoyan-2027-exam",
        "date": "2026-12-20",
        "title": "初试",
        "category": "总节点",
        "detail": "浙江大学 科学与技术教育（045117）",
        "notify_days_before": 14,
    },
)


def _clean_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _clean_int(value: Any, *, default: int, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, parsed))


def _normalize_item(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    on = coerce_exam_date(raw.get("date"))
    title = _clean_text(raw.get("title"), MAX_TITLE_CHARS)
    if on is None or not title:
        return None
    return {
        "id": _clean_text(raw.get("id"), 64) or uuid.uuid4().hex[:12],
        "date": on.isoformat(),
        "title": title,
        "category": _clean_text(raw.get("category"), 20),
        "detail": _clean_text(raw.get("detail"), MAX_DETAIL_CHARS),
        "notify_days_before": _clean_int(
            raw.get("notify_days_before"),
            default=DEFAULT_NOTIFY_DAYS,
            low=0,
            high=MAX_NOTIFY_DAYS,
        ),
        "enabled": bool(raw.get("enabled", True)),
        "done": bool(raw.get("done", False)),
    }


def _sort_key(item: dict[str, Any]) -> tuple[str, str]:
    return (item["date"], item["id"])


def _row(session: Session) -> Config | None:
    return session.query(Config).filter(Config.key == MILESTONES_KEY).one_or_none()


def _stored(session: Session) -> list[dict[str, Any]] | None:
    row = _row(session)
    if row is None or not row.value:
        return None
    try:
        loaded = json.loads(row.value)
    except (TypeError, ValueError):
        return []
    if not isinstance(loaded, list):
        return []
    items = [_normalize_item(raw) for raw in loaded]
    return sorted((item for item in items if item is not None), key=_sort_key)


def _write(session: Session, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(items, key=_sort_key)[:MAX_MILESTONES]
    value = json.dumps(ordered, ensure_ascii=False)
    row = _row(session)
    if row is None:
        session.add(Config(key=MILESTONES_KEY, value=value, updated_at=utc_now_naive()))
    else:
        row.value = value
        row.updated_at = utc_now_naive()
    session.commit()
    return ordered


def ensure_milestones(session: Session) -> list[dict[str, Any]]:
    """Seed the plan's checkpoints the first time, then leave them alone."""
    stored = _stored(session)
    if stored is not None:
        return stored
    seeded = [
        _normalize_item({**item, "enabled": True, "done": False})
        for item in DEFAULT_MILESTONES
    ]
    return _write(session, [item for item in seeded if item is not None])


def sprint_state(session: Session, *, today: date | None = None) -> dict[str, Any]:
    """The sprint switch plus the interval ceiling it currently implies."""
    on = today or local_day()
    row = session.query(Config).filter(Config.key == EXAM_SETTINGS_KEY).one_or_none()
    settings = read_exam_settings(row.value if row is not None else None)
    horizon = resolve_sprint_horizon(
        exam_date=settings.get("exam_date"),
        sprint_mode=bool(settings.get("sprint_mode")),
        today=on,
    )
    if horizon is None:
        return {
            "active": False,
            "sprint_mode": bool(settings.get("sprint_mode")),
            "exam_date": settings.get("exam_date") or None,
            "days_left": None,
            "max_interval_days": None,
            "last_due": None,
        }
    return {**horizon.payload(), "sprint_mode": True}


def list_milestones(session: Session, *, today: date | None = None) -> dict[str, Any]:
    on = today or local_day()
    items = ensure_milestones(session)
    rows: list[dict[str, Any]] = []
    for item in items:
        due = date.fromisoformat(item["date"])
        days_left = (due - on).days
        rows.append(
            {
                **item,
                "days_left": days_left,
                "status": _status(item, days_left),
                "reminder": _reminder(item, days_left),
            }
        )
    return {
        "today": on.isoformat(),
        "items": rows,
        "counts": {
            "total": len(rows),
            "done": sum(1 for row in rows if row["done"]),
            "overdue": sum(1 for row in rows if row["status"] == "overdue"),
            "due_soon": sum(1 for row in rows if row["status"] == "due_soon"),
        },
    }


def _reminder(item: dict[str, Any], days_left: int) -> str | None:
    """The two in-app reminder moments: the lead day, then the day itself.

    Deliberately exactly two. Repeating daily until done is how a reminder turns
    into noise and gets ignored for everything else as well.
    """
    if not item["enabled"] or item["done"]:
        return None
    if days_left == 0:
        return "today"
    if days_left == int(item["notify_days_before"]):
        return "lead"
    return None


def _status(item: dict[str, Any], days_left: int) -> str:
    if item["done"]:
        return "done"
    if days_left < 0:
        return "overdue"
    if days_left <= int(item["notify_days_before"]):
        return "due_soon"
    return "upcoming"


def milestone_upcoming(session: Session, *, today: date | None = None) -> dict[str, Any]:
    """The next two milestone *days* for the start page, with every item on each.

    Dated checkpoints cluster (10/31 carries both 中教史 and 马原), so a single
    "next milestone" would hide the sibling that shares its day. Only two days
    are returned: the start page is a glance, not the plan.

    Read-only on purpose: it never seeds, so a page that renders on every visit
    cannot start writing milestones it did not have.
    """
    on = today or local_day()
    stored = _stored(session) or []
    by_day: dict[date, list[dict[str, Any]]] = {}
    overdue = 0
    for item in stored:
        if not item["enabled"] or item["done"]:
            continue
        due = date.fromisoformat(item["date"])
        if due < on:
            overdue += 1
            continue
        by_day.setdefault(due, []).append(item)
    groups = [
        {
            "date": day.isoformat(),
            "days_left": (day - on).days,
            "items": [
                {
                    "id": item["id"],
                    "title": item["title"],
                    "category": item["category"],
                    "detail": item["detail"],
                }
                for item in sorted(rows, key=lambda row: (row["category"], row["id"]))
            ],
        }
        for day, rows in sorted(by_day.items())[:2]
    ]
    return {"today": on.isoformat(), "groups": groups, "overdue_count": overdue}


def save_milestones(session: Session, items: Any) -> dict[str, Any]:
    if not isinstance(items, list):
        raise ValueError("milestones must be a list")
    normalized = [_normalize_item(raw) for raw in items]
    cleaned = [item for item in normalized if item is not None]
    if len(cleaned) != len(items):
        raise ValueError("每个里程碑都需要日期（YYYY-MM-DD）和标题")
    _write(session, cleaned)
    return list_milestones(session)


__all__ = [
    "DEFAULT_MILESTONES",
    "MILESTONES_KEY",
    "ensure_milestones",
    "list_milestones",
    "milestone_upcoming",
    "save_milestones",
    "sprint_state",
]
