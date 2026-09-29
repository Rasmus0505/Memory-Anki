"""Stamp book: achievements over counters that only ever grow, so a stamp never un-earns."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .rules import MARATHON_MINUTES, NIGHT_OR_DAWN_MIN, DayStats, level_for


@dataclass(frozen=True)
class StampDef:
    id: str
    title: str
    description: str
    group: str
    tier: str
    metric: str
    target: int


def _ladder(prefix: str, group: str, metric: str, steps: list[tuple[int, str, str, str]]) -> list[StampDef]:
    return [StampDef(f"{prefix}_{target}", title, description, group, tier, metric, target) for target, title, description, tier in steps]


STAMPS: tuple[StampDef, ...] = (
    *_ladder("ratings", "复习", "ratings", [
        (100, "初翻百卡", "累计评分 100 张", "paper"),
        (1000, "千卡行者", "累计评分 1000 张", "silver"),
        (5000, "五千回响", "累计评分 5000 张", "gold"),
        (20000, "万卷在胸", "累计评分 20000 张", "gold"),
    ]),
    *_ladder("days", "坚持", "active_days", [
        (7, "七日之约", "累计学习 7 天（不必连续）", "paper"),
        (30, "一月耕读", "累计学习 30 天", "silver"),
        (100, "百日筑基", "累计学习 100 天", "gold"),
        (365, "岁岁不辍", "累计学习 365 天", "gold"),
    ]),
    *_ladder("conquer", "攻克", "conquered", [
        (10, "拨云见日", "攻克 10 张忘记过的卡", "paper"),
        (100, "百折不挠", "攻克 100 张忘记过的卡", "silver"),
        (500, "逆风翻盘", "攻克 500 张忘记过的卡", "gold"),
    ]),
    *_ladder("star3", "考点", "star3_passes", [
        (50, "要点在握", "三星卡记得 50 次", "paper"),
        (500, "重点收割", "三星卡记得 500 次", "gold"),
    ]),
    *_ladder("quiz", "做题", "quiz_correct", [
        (50, "小试牛刀", "答对 50 道题", "paper"),
        (500, "题海泛舟", "答对 500 道题", "silver"),
    ]),
    *_ladder("perfect", "完美", "perfect_rounds", [
        (1, "一轮无瑕", "一轮至少 10 张、全部记得或轻松", "silver"),
        (10, "十全十美", "完成 10 个无瑕轮", "gold"),
    ]),
    StampDef("night_owl", "夜读人", f"一天里 23 点后评 {NIGHT_OR_DAWN_MIN} 张卡", "时光", "paper", "night_days", 1),
    StampDef("early_bird", "晨读人", f"一天里 5–8 点评 {NIGHT_OR_DAWN_MIN} 张卡", "时光", "paper", "dawn_days", 1),
    StampDef("marathon", "长跑者", f"一天专注 {MARATHON_MINUTES} 分钟", "时光", "silver", "marathon_days", 1),
    *_ladder("quests", "委托", "quests_done", [
        (10, "有求必应", "完成 10 个委托", "paper"),
        (100, "委托达人", "完成 100 个委托", "gold"),
    ]),
    *_ladder("level", "等级", "level", [
        (10, "登堂", "达到 Lv.10", "silver"),
        (25, "入室", "达到 Lv.25", "gold"),
        (50, "宗师", "达到 Lv.50", "gold"),
    ]),
)


@dataclass(frozen=True)
class StampProgress:
    stamp: StampDef
    progress: int
    unlocked_on: date | None


def walk_stamps(
    days: dict[date, DayStats],
    perfect_days: list[date],
    quest_days: dict[date, int],
    quest_counts: dict[date, int],
    xp_by_day: dict[date, float],
) -> list[StampProgress]:
    counters: dict[str, int] = dict.fromkeys({stamp.metric for stamp in STAMPS}, 0)
    unlocked: dict[str, date] = {}
    perfect_by_day: dict[date, int] = {}
    for day in perfect_days:
        perfect_by_day[day] = perfect_by_day.get(day, 0) + 1
    running_xp = 0.0
    for day in sorted(set(days) | set(perfect_by_day) | set(quest_days)):
        stats = days.get(day, DayStats())
        counters["ratings"] += stats.ratings
        counters["active_days"] += 1 if stats.active else 0
        counters["conquered"] += stats.conquered
        counters["star3_passes"] += stats.star3_passes
        counters["quiz_correct"] += stats.quiz_correct
        counters["perfect_rounds"] += perfect_by_day.get(day, 0)
        counters["night_days"] += 1 if stats.night >= NIGHT_OR_DAWN_MIN else 0
        counters["dawn_days"] += 1 if stats.dawn >= NIGHT_OR_DAWN_MIN else 0
        counters["marathon_days"] += 1 if stats.minutes >= MARATHON_MINUTES else 0
        counters["quests_done"] += quest_counts.get(day, 0)
        running_xp += xp_by_day.get(day, 0.0)
        counters["level"] = level_for(round(running_xp))
        for stamp in STAMPS:
            if stamp.id not in unlocked and counters[stamp.metric] >= stamp.target:
                unlocked[stamp.id] = day
    return [StampProgress(stamp, min(stamp.target, counters[stamp.metric]), unlocked.get(stamp.id)) for stamp in STAMPS]
