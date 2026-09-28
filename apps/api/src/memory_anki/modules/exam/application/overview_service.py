"""Exam overview: countdown, mastery prediction, retention, stars, weak spots."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import QuizAttemptEvent
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitRatingOperation,
    ReviewUnitState,
)

from ..domain.priority import palace_priority, share_factor
from ..domain.retention import (
    MASTERED_RECALL,
    UnitMemory,
    forgetting_degree,
    mastered_ratio,
    mean_recall,
    recall_probability,
    retention_curve,
)
from ..domain.stars import SOURCE_DERIVED
from .settings_service import get_exam_settings
from .star_context import load_palace_contexts, subject_shares

PACE_WINDOW_DAYS = 14
OBSERVED_WINDOW_DAYS = 30
WEAK_LIMIT = 8


def _local_date(value: datetime | None) -> date | None:
    if value is None:
        return None
    # Stored rows are UTC-naive; convert to local wall-clock date.
    return value.replace(tzinfo=UTC).astimezone().date()


def _was_unlearned(before_state_json: str) -> bool:
    try:
        payload = json.loads(before_state_json or "{}")
    except json.JSONDecodeError:
        return False
    state = payload.get("state") if isinstance(payload, dict) else None
    return isinstance(state, dict) and state.get("has_passed") is False


def _rating_activity(session: Session, today: date) -> dict[str, Any]:
    since = datetime.combine(today - timedelta(days=OBSERVED_WINDOW_DAYS + 1), datetime.min.time())
    rows = (
        session.query(
            ReviewUnitRatingOperation.unit_id,
            ReviewUnitRatingOperation.passed,
            ReviewUnitRatingOperation.before_state_json,
            ReviewUnitRatingOperation.created_at,
        )
        .filter(ReviewUnitRatingOperation.undone_at.is_(None))
        .filter(ReviewUnitRatingOperation.replaced_at.is_(None))
        .filter(ReviewUnitRatingOperation.created_at >= since)
        .all()
    )
    per_day: dict[date, list[int]] = {}
    newly_learned: set[str] = set()
    pace_start = today - timedelta(days=PACE_WINDOW_DAYS - 1)
    reviewed_today = 0
    for row in rows:
        day = _local_date(row.created_at)
        if day is None:
            continue
        bucket = per_day.setdefault(day, [0, 0])
        bucket[0] += 1
        bucket[1] += 1 if row.passed else 0
        if day == today:
            reviewed_today += 1
        if row.passed and day >= pace_start and _was_unlearned(row.before_state_json):
            newly_learned.add(str(row.unit_id))
    observed: list[dict[str, Any]] = []
    for offset in range(OBSERVED_WINDOW_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        reviews, passes = per_day.get(day, [0, 0])
        observed.append(
            {
                "date": day.isoformat(),
                "reviews": reviews,
                "pass_rate": round(passes / reviews, 4) if reviews else None,
            }
        )
    return {
        "observed": observed,
        "pace_per_day": len(newly_learned) / PACE_WINDOW_DAYS,
        "reviewed_today": reviewed_today,
    }


def _study_days(session: Session) -> int:
    days: set[date] = set()
    for (created_at,) in session.query(ReviewUnitRatingOperation.created_at).filter(
        ReviewUnitRatingOperation.undone_at.is_(None)
    ):
        day = _local_date(created_at)
        if day is not None:
            days.add(day)
    for (created_at,) in session.query(QuizAttemptEvent.created_at):
        day = _local_date(created_at)
        if day is not None:
            days.add(day)
    return len(days)


def _ratio(part: float, whole: float) -> float:
    return round(part / whole, 4) if whole else 0.0


def build_exam_overview(session: Session, *, today: date | None = None) -> dict[str, Any]:
    on = today or date.today()
    settings = get_exam_settings(session)
    exam_date = date.fromisoformat(settings["exam_date"]) if settings.get("exam_date") else None
    days_left = (exam_date - on).days if exam_date else None
    horizon = exam_date if exam_date and exam_date > on else on

    contexts = load_palace_contexts(session)
    subject_filter = set(settings.get("subject_ids") or [])
    if subject_filter:
        contexts = {pid: ctx for pid, ctx in contexts.items() if ctx.subject_id in subject_filter}
    shares, subject_count = subject_shares(session)
    all_units: list[UnitMemory] = [unit for ctx in contexts.values() for unit in ctx.units]
    total = len(all_units)
    learned = sum(1 for unit in all_units if unit.has_passed)
    mastered_now = sum(1 for unit in all_units if recall_probability(unit, on) >= MASTERED_RECALL)
    mastered_if_idle = sum(1 for unit in all_units if recall_probability(unit, horizon) >= MASTERED_RECALL)
    activity = _rating_activity(session, on)
    remaining_days = max(0, days_left or 0)
    unlearned = total - learned
    projected_new = min(unlearned, activity["pace_per_day"] * remaining_days)
    # Reviews keep learned units near the 90% target; new units join at the same rate.
    projected_mastered = min(total, learned + projected_new)
    due_today = (
        session.query(ReviewUnitState.id)
        .filter(ReviewUnitState.active.is_(True))
        .filter(ReviewUnitState.due_date <= on)
        .filter(ReviewUnitState.palace_id.in_(list(contexts) or [-1]))
        .count()
    )

    subjects = {int(s.id): s for s in session.query(Subject).all()}
    subject_rows: list[dict[str, Any]] = []
    for subject_id in sorted({ctx.subject_id for ctx in contexts.values() if ctx.subject_id}):
        units = [u for ctx in contexts.values() if ctx.subject_id == subject_id for u in ctx.units]
        subject = subjects.get(subject_id)
        subject_rows.append(
            {
                "id": subject_id,
                "name": subject.name if subject else f"学科 {subject_id}",
                "color": subject.color if subject else "",
                "exam_share": shares.get(subject_id),
                "unit_count": len(units),
                "learned_ratio": _ratio(sum(1 for u in units if u.has_passed), len(units)),
                "mastery_ratio": round(mastered_ratio(units, on), 4),
                "predicted_ratio": _ratio(
                    min(len(units), sum(1 for u in units if u.has_passed) + projected_new * _ratio(len(units), total)),
                    len(units),
                ),
            }
        )

    star_rows = []
    for stars in (3, 2, 1):
        group = [ctx for ctx in contexts.values() if ctx.stars.stars == stars]
        units = [u for ctx in group for u in ctx.units]
        star_rows.append(
            {
                "stars": stars,
                "palace_count": len(group),
                "unit_count": len(units),
                "mastery_ratio": round(mastered_ratio(units, on), 4),
            }
        )

    palaces: list[dict[str, Any]] = []
    for ctx in contexts.values():
        forgetting = forgetting_degree(ctx.units, on)
        palaces.append(
            {
                "id": ctx.palace_id,
                "title": ctx.title,
                "subject_id": ctx.subject_id,
                "chapter_id": ctx.primary_chapter_id,
                "stars": ctx.stars.stars,
                "stars_source": ctx.stars.source,
                "own_stars": ctx.own_stars,
                "question_count": ctx.question_count,
                "subjective_count": ctx.subjective_count,
                "unit_count": len(ctx.units),
                "learned_count": sum(1 for u in ctx.units if u.has_passed),
                "mastery_ratio": round(mastered_ratio(ctx.units, on), 4),
                "recall": round(mean_recall(ctx.units, on), 4),
                "priority": round(
                    palace_priority(
                        ctx.stars.stars,
                        forgetting,
                        share_factor(shares.get(ctx.subject_id) if ctx.subject_id else None, subject_count),
                    ),
                    4,
                ),
            }
        )
    palaces.sort(key=lambda row: (-row["priority"], row["id"]))
    weak = [row for row in palaces if row["unit_count"] and row["recall"] < MASTERED_RECALL][:WEAK_LIMIT]

    chapters = [
        {
            "id": int(c.id),
            "subject_id": int(c.subject_id),
            "parent_id": int(c.parent_id) if c.parent_id else None,
            "name": c.name,
            "sort_order": c.sort_order or 0,
            "exam_stars": c.exam_stars,
            "exam_stars_source": c.exam_stars_source,
        }
        for c in session.query(Chapter).order_by(Chapter.subject_id, Chapter.sort_order, Chapter.id)
    ]

    learned_units = [u for u in all_units if u.has_passed]
    curve_days = min(120, max(30, (remaining_days or 0) + 1))
    return {
        "settings": settings,
        "today": on.isoformat(),
        "days_left": days_left,
        "totals": {
            "unit_count": total,
            "learned_count": learned,
            "learned_ratio": _ratio(learned, total),
            "mastery_ratio": _ratio(mastered_now, total),
            "predicted_ratio": _ratio(projected_mastered, total),
            "predicted_if_idle_ratio": _ratio(mastered_if_idle, total),
            "pace_per_day": round(activity["pace_per_day"], 2),
            "needed_per_day": round(unlearned / remaining_days, 2) if remaining_days else float(unlearned),
            "due_today": due_today,
            "reviewed_today": activity["reviewed_today"],
            "study_days": _study_days(session),
        },
        "subjects": subject_rows,
        "stars": star_rows,
        "palaces": palaces,
        "chapters": chapters,
        "weak": weak,
        "retention": {
            "projected": retention_curve(learned_units, on, curve_days),
            "observed": activity["observed"],
        },
        "star_rule": {
            "source_derived": SOURCE_DERIVED,
            "description": "未写入星级时：分值 = 题目数 + 2 × 主观题数；≥12 为 3 星，≥5 为 2 星，其余 1 星。",
        },
    }
