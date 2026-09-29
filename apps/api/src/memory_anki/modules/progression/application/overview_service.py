"""Progression overview: load recorded evidence, project it, serialize. Never writes."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import QuizAttemptEvent
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
)
from memory_anki.modules.exam.api import build_memory_snapshot

from ..domain.projection import Progression, project
from ..domain.rules import QuizEvent, RatingEvent, StudyBlock


def _local(value: datetime | None) -> datetime | None:
    # Stored rows are UTC-naive; days and hours are the learner's wall clock.
    return value.replace(tzinfo=UTC).astimezone() if value else None


def load_evidence(session: Session, stars: dict[int, int]) -> tuple[list[RatingEvent], list[QuizEvent], list[StudyBlock]]:
    ratings: list[RatingEvent] = []
    rows = (
        session.query(
            ReviewUnitRatingOperation.unit_id,
            ReviewUnitRatingOperation.palace_id,
            ReviewUnitRatingOperation.rating,
            ReviewUnitRatingOperation.passed,
            ReviewUnitRatingOperation.created_at,
            ReviewUnitEncounter.round_id,
        )
        .outerjoin(ReviewUnitEncounter, ReviewUnitEncounter.id == ReviewUnitRatingOperation.encounter_id)
        .filter(ReviewUnitRatingOperation.undone_at.is_(None))
        .filter(ReviewUnitRatingOperation.replaced_at.is_(None))
        .order_by(ReviewUnitRatingOperation.created_at, ReviewUnitRatingOperation.id)
    )
    for row in rows:
        at = _local(row.created_at)
        if at is None:
            continue
        ratings.append(
            RatingEvent(
                unit_id=str(row.unit_id),
                rating=int(row.rating),
                passed=bool(row.passed),
                day=at.date(),
                hour=at.hour,
                stars=stars.get(int(row.palace_id), 1),
                round_id=str(row.round_id) if row.round_id else None,
            )
        )

    quizzes: list[QuizEvent] = []
    for question_id, palace_id, is_correct, created_at in session.query(
        QuizAttemptEvent.question_id,
        QuizAttemptEvent.palace_id,
        QuizAttemptEvent.is_correct,
        QuizAttemptEvent.created_at,
    ):
        at = _local(created_at)
        if at is None:
            continue
        quizzes.append(
            QuizEvent(
                question_id=int(question_id) if question_id is not None else None,
                correct=bool(is_correct),
                day=at.date(),
                stars=stars.get(int(palace_id), 1) if palace_id is not None else 1,
            )
        )

    blocks: list[StudyBlock] = []
    for started_at, seconds in (
        session.query(StudySession.started_at, StudySession.effective_seconds)
        .filter(StudySession.deleted_at.is_(None))
        .filter(StudySession.effective_seconds > 0)
    ):
        at = _local(started_at)
        if at is not None:
            blocks.append(StudyBlock(day=at.date(), seconds=int(seconds)))
    return ratings, quizzes, blocks


def serialize(progression: Progression) -> dict[str, Any]:
    level = progression.level
    return {
        "today": progression.today.isoformat(),
        "level": {
            "level": level.level,
            "xp": level.xp,
            "level_floor": level.level_floor,
            "next_level_xp": level.next_level_xp,
            "progress": level.progress,
        },
        "xp": {"today": progression.xp_today, "week": progression.xp_week, "sources": progression.sources},
        "quests": [
            {
                "key": quest.key,
                "title": quest.title,
                "hint": quest.hint,
                "scope": quest.scope,
                "progress": quest.progress,
                "target": quest.target,
                "done": quest.done,
                "xp": quest.xp,
            }
            for quest in progression.quests
        ],
        "stamps": [
            {
                "id": item.stamp.id,
                "title": item.stamp.title,
                "description": item.stamp.description,
                "group": item.stamp.group,
                "tier": item.stamp.tier,
                "progress": item.progress,
                "target": item.stamp.target,
                "unlocked_on": item.unlocked_on.isoformat() if item.unlocked_on else None,
            }
            for item in progression.stamps
        ],
        "stats": progression.stats,
    }


def build_progression_overview(session: Session, *, today: date | None = None) -> dict[str, Any]:
    on = today or date.today()
    starmap = build_memory_snapshot(session, today=on)
    stars = {int(row["id"]): int(row["stars"]) for row in starmap["palaces"]}
    progression = project(*load_evidence(session, stars), today=on)
    return {**serialize(progression), "starmap": starmap}
