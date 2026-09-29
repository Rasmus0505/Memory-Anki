"""Daily and weekly quests: picked by a hash of the date, judged from that day's stats.

Optional by design: an unfinished quest simply expires. Nothing accumulates and
nothing is lost, so the board can invite without nagging.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, timedelta

from .rules import DayStats

DAILY_COUNT = 3
DAILY_XP = 30
WEEKLY_XP = 150


@dataclass(frozen=True)
class QuestTemplate:
    key: str
    title: str
    metric: str
    target: int
    hint: str


DAILY_TEMPLATES = (
    QuestTemplate("rate_20", "评 20 张卡", "ratings", 20, "随心里刷完一小轮就够"),
    QuestTemplate("rate_40", "评 40 张卡", "ratings", 40, "一轮深度练习"),
    QuestTemplate("conquer_3", "攻克 3 张忘记过的卡", "conquered", 3, "上次忘记、这次记得就算"),
    QuestTemplate("star_10", "复习 10 张三星卡", "high_star", 10, "高分值章节优先"),
    QuestTemplate("learn_5", "新学会 5 张卡", "first_learned", 5, "第一次评到记得"),
    QuestTemplate("quiz_5", "答对 5 道题", "quiz_correct", 5, "随心工具栏的做题"),
    QuestTemplate("focus_25", "专注学习 25 分钟", "minutes", 25, "一个番茄钟"),
)

WEEKLY_TEMPLATES = (
    QuestTemplate("week_days_5", "本周学习 5 天", "active_days", 5, "每天一点点就算"),
    QuestTemplate("week_rate_200", "本周评 200 张卡", "ratings", 200, "攒着慢慢来"),
    QuestTemplate("week_conquer_15", "本周攻克 15 张卡", "conquered", 15, "薄弱点最值钱"),
    QuestTemplate("week_minutes_300", "本周专注 5 小时", "minutes", 300, "计时器会自动记"),
)


def _rank(seed: str, key: str) -> str:
    return hashlib.sha256(f"{seed}:{key}".encode()).hexdigest()


def daily_quests(day: date) -> list[QuestTemplate]:
    ranked = sorted(DAILY_TEMPLATES, key=lambda template: _rank(day.isoformat(), template.key))
    picked: list[QuestTemplate] = []
    for template in ranked:
        # Never two quests on the same metric in one day.
        if all(template.metric != other.metric for other in picked):
            picked.append(template)
        if len(picked) == DAILY_COUNT:
            break
    return picked


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def weekly_quest(day: date) -> QuestTemplate:
    start = week_start(day).isoformat()
    return min(WEEKLY_TEMPLATES, key=lambda template: _rank(f"week:{start}", template.key))


def metric_value(stats: DayStats, metric: str) -> int:
    if metric == "active_days":
        return 1 if stats.active else 0
    return int(getattr(stats, metric))


def week_value(days: dict[date, DayStats], day: date, metric: str, *, until: date | None = None) -> int:
    start = week_start(day)
    end = until or start + timedelta(days=6)
    total = 0
    current = start
    while current <= end:
        stats = days.get(current)
        if stats is not None:
            total += metric_value(stats, metric)
        current += timedelta(days=1)
    return total


@dataclass(frozen=True)
class QuestProgress:
    key: str
    title: str
    hint: str
    progress: int
    target: int
    xp: int
    scope: str

    @property
    def done(self) -> bool:
        return self.progress >= self.target


def quest_board(days: dict[date, DayStats], today: date) -> list[QuestProgress]:
    stats = days.get(today, DayStats())
    board = [
        QuestProgress(t.key, t.title, t.hint, min(t.target, metric_value(stats, t.metric)), t.target, DAILY_XP, "daily")
        for t in daily_quests(today)
    ]
    weekly = weekly_quest(today)
    board.append(
        QuestProgress(
            weekly.key,
            weekly.title,
            weekly.hint,
            min(weekly.target, week_value(days, today, weekly.metric, until=today)),
            weekly.target,
            WEEKLY_XP,
            "weekly",
        )
    )
    return board


def quest_xp_by_day(days: dict[date, DayStats]) -> tuple[dict[date, int], dict[date, int]]:
    """Quest XP and completed-quest count, credited on the day each quest was finished."""
    credited: dict[date, int] = {}
    counts: dict[date, int] = {}

    def credit(day: date, xp: int) -> None:
        credited[day] = credited.get(day, 0) + xp
        counts[day] = counts.get(day, 0) + 1

    for day, stats in days.items():
        for template in daily_quests(day):
            if metric_value(stats, template.metric) >= template.target:
                credit(day, DAILY_XP)
    for start in sorted({week_start(day) for day in days}):
        template = weekly_quest(start)
        running = 0
        for offset in range(7):
            current = start + timedelta(days=offset)
            day_stats = days.get(current)
            if day_stats is None:
                continue
            running += metric_value(day_stats, template.metric)
            if running >= template.target:
                credit(current, WEEKLY_XP)
                break
    return credited, counts
