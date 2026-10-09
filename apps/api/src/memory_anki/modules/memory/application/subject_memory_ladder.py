"""Read-only subject memory ladder.

Groups active review units onto the ten scheduling stages. This query never
reconciles, repairs, or commits: a palace appears in every stage where it
already has an active unit, and the shown review time is the earliest due
date among those units.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import to_api_datetime, utc_now_naive
from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.palaces import Palace, palace_subject_table
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState

from .unit_scheduler import INTERVAL_DAYS, clamp_stage

UNASSIGNED_SUBJECT_NAME = "未分类"
UNASSIGNED_SUBJECT_COLOR = "#94a3b8"


def _empty_stages() -> list[dict[str, Any]]:
    return [
        {
            "stage_index": index,
            "interval_days": interval,
            "palace_count": 0,
            "unit_count": 0,
            "overdue_palace_count": 0,
            "palaces": [],
        }
        for index, interval in enumerate(INTERVAL_DAYS)
    ]


def _palace_card(
    palace_id: int,
    title: str,
    due: date,
    unit_count: int,
    *,
    today: date,
) -> dict[str, Any]:
    return {
        "palace_id": palace_id,
        "title": title or "未命名宫殿",
        "due_date": due.isoformat(),
        "overdue": due < today,
        "due_today": due == today,
        "unit_count": unit_count,
    }


def _finish_stages(stages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for stage in stages:
        stage["palaces"].sort(
            key=lambda item: (item["due_date"], item["title"], item["palace_id"])
        )
    return stages


def get_subject_memory_ladder(
    session: Session,
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """Map active units to subject stages without writing schedule state."""
    today = today or date.today()
    with session.no_autoflush:
        subjects = (
            session.query(Subject)
            .order_by(Subject.sort_order.asc(), Subject.id.asc())
            .all()
        )
        links = session.query(
            palace_subject_table.c.palace_id,
            palace_subject_table.c.subject_id,
        ).all()
        rows = (
            session.query(
                ReviewUnitState.palace_id,
                ReviewUnitState.stage_index,
                ReviewUnitState.due_date,
                Palace.title,
            )
            .join(Palace, Palace.id == ReviewUnitState.palace_id)
            .filter(
                ReviewUnitState.active.is_(True),
                Palace.deleted_at.is_(None),
                Palace.archived.is_(False),
            )
            .all()
        )

    palaces: dict[int, dict[str, Any]] = {}
    for palace_id, stage_index, due_date, title in rows:
        stage = clamp_stage(int(stage_index))
        palace = palaces.setdefault(
            int(palace_id),
            {"title": title or "未命名宫殿", "stages": {}},
        )
        bucket = palace["stages"].setdefault(stage, {"due": due_date, "count": 0})
        bucket["count"] += 1
        if due_date < bucket["due"]:
            bucket["due"] = due_date

    subjects_by_palace: dict[int, set[int]] = defaultdict(set)
    for palace_id, subject_id in links:
        subjects_by_palace[int(palace_id)].add(int(subject_id))

    stages_by_subject: dict[int | None, list[dict[str, Any]]] = {
        int(subject.id): _empty_stages() for subject in subjects
    }
    unassigned_ids = [
        palace_id
        for palace_id in palaces
        if not subjects_by_palace.get(palace_id)
    ]
    if unassigned_ids:
        stages_by_subject[None] = _empty_stages()

    for palace_id, palace in palaces.items():
        owner_ids = subjects_by_palace.get(palace_id) or {None}
        for subject_id in owner_ids:
            stages = stages_by_subject.get(subject_id)
            if stages is None:
                continue
            for stage_index, bucket in palace["stages"].items():
                card = _palace_card(
                    palace_id,
                    palace["title"],
                    bucket["due"],
                    bucket["count"],
                    today=today,
                )
                stage = stages[stage_index]
                stage["palaces"].append(card)
                stage["palace_count"] += 1
                stage["unit_count"] += bucket["count"]
                if card["overdue"]:
                    stage["overdue_palace_count"] += 1

    items: list[dict[str, Any]] = []
    for subject in subjects:
        stages = _finish_stages(stages_by_subject[int(subject.id)])
        items.append(
            {
                "subject_id": int(subject.id),
                "name": subject.name,
                "color": subject.color or "#6366f1",
                "palace_count": len({
                    palace["palace_id"]
                    for stage in stages
                    for palace in stage["palaces"]
                }),
                "stages": stages,
            }
        )
    if None in stages_by_subject:
        stages = _finish_stages(stages_by_subject[None])
        items.append(
            {
                "subject_id": None,
                "name": UNASSIGNED_SUBJECT_NAME,
                "color": UNASSIGNED_SUBJECT_COLOR,
                "palace_count": len({
                    palace["palace_id"]
                    for stage in stages
                    for palace in stage["palaces"]
                }),
                "stages": stages,
            }
        )

    return {
        "ladder": list(INTERVAL_DAYS),
        "generated_at": to_api_datetime(utc_now_naive()),
        "subjects": items,
    }
