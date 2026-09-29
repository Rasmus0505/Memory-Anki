"""Assemble the whole progression view from evidence. Pure: same evidence, same answer."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .quests import QuestProgress, quest_board, quest_xp_by_day, week_start
from .rules import QuizEvent, RatingEvent, StudyBlock, build_days, level_for, xp_for_level
from .stamps import StampProgress, walk_stamps

XP_SOURCES = ("rating", "conquer", "first_learn", "quiz", "time", "quest")


@dataclass(frozen=True)
class LevelView:
    level: int
    xp: int
    level_floor: int
    next_level_xp: int

    @property
    def progress(self) -> float:
        span = self.next_level_xp - self.level_floor
        return round((self.xp - self.level_floor) / span, 4) if span > 0 else 1.0


@dataclass(frozen=True)
class Progression:
    today: date
    level: LevelView
    xp_today: int
    xp_week: int
    sources: dict[str, int]
    quests: list[QuestProgress]
    stamps: list[StampProgress]
    stats: dict[str, int]


def project(
    ratings: list[RatingEvent],
    quizzes: list[QuizEvent],
    blocks: list[StudyBlock],
    today: date,
) -> Progression:
    days, perfect_days = build_days(sorted(ratings, key=lambda e: (e.day, e.hour)), quizzes, blocks)
    quest_xp, quest_counts = quest_xp_by_day(days)
    xp_by_day: dict[date, float] = {}
    sources = dict.fromkeys(XP_SOURCES, 0.0)
    for day in set(days) | set(quest_xp):
        stats = days.get(day)
        total = float(quest_xp.get(day, 0))
        sources["quest"] += quest_xp.get(day, 0)
        if stats is not None:
            for source, value in stats.xp.items():
                sources[source] += value
                total += value
        xp_by_day[day] = total

    xp = round(sum(xp_by_day.values()))
    level = level_for(xp)
    monday = week_start(today)
    stamps = walk_stamps(days, perfect_days, quest_xp, quest_counts, xp_by_day)
    totals = list(days.values())
    return Progression(
        today=today,
        level=LevelView(level=level, xp=xp, level_floor=xp_for_level(level), next_level_xp=xp_for_level(level + 1)),
        xp_today=round(xp_by_day.get(today, 0.0)),
        xp_week=round(sum(value for day, value in xp_by_day.items() if monday <= day <= today)),
        sources={source: round(value) for source, value in sources.items()},
        quests=quest_board(days, today),
        stamps=stamps,
        stats={
            "ratings": sum(s.ratings for s in totals),
            "conquered": sum(s.conquered for s in totals),
            "first_learned": sum(s.first_learned for s in totals),
            "quiz_correct": sum(s.quiz_correct for s in totals),
            "minutes": sum(s.minutes for s in totals),
            "active_days": sum(1 for s in totals if s.active),
            "perfect_rounds": len(perfect_days),
            "quests_done": sum(quest_counts.values()),
            "stamps_unlocked": sum(1 for stamp in stamps if stamp.unlocked_on),
        },
    )
