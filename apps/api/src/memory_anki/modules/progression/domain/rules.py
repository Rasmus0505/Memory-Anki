"""Progression rules: XP, levels, quests and stamps. Framework-free and deterministic.

Everything is derived from recorded evidence (ratings, quiz attempts, study time),
so two devices always agree and history counts the moment the rules ship.
XP rewards quality: honest recall, exam value and conquering what was forgotten.
Nothing here ever takes XP away or punishes a missed day.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date

GRADE_XP = {1: 4, 2: 8, 3: 12, 4: 14}
STAR_MULTIPLIER = {1: 1.0, 2: 1.25, 3: 1.6}
CONQUER_BONUS = 15
FIRST_LEARN_BONUS = 8
QUIZ_CORRECT_XP = 8
QUIZ_TRIED_XP = 3
SESSION_MINUTE_CAP = 120
# Same card (or question) rated again on the same day earns less each time.
REPEAT_FACTORS = (1.0, 0.5, 0.25)
REPEAT_FLOOR = 0.1
PERFECT_ROUND_MIN = 10
NIGHT_OR_DAWN_MIN = 10
MARATHON_MINUTES = 120
LEVEL_BASE = 150
LEVEL_EXPONENT = 1.9


def repeat_factor(nth: int) -> float:
    return REPEAT_FACTORS[nth] if nth < len(REPEAT_FACTORS) else REPEAT_FLOOR


def star_multiplier(stars: int) -> float:
    return STAR_MULTIPLIER.get(stars, 1.0)


def xp_for_level(level: int) -> int:
    """Total XP needed to reach ``level``: quick early levels, a long gentle tail."""
    return 0 if level <= 1 else round(LEVEL_BASE * (level - 1) ** LEVEL_EXPONENT)


def level_for(xp: int) -> int:
    level = 1
    while xp_for_level(level + 1) <= xp:
        level += 1
    return level


@dataclass(frozen=True)
class RatingEvent:
    unit_id: str
    rating: int
    passed: bool
    day: date
    hour: int
    stars: int = 1
    round_id: str | None = None


@dataclass(frozen=True)
class QuizEvent:
    question_id: int | None
    correct: bool
    day: date
    stars: int = 1


@dataclass(frozen=True)
class StudyBlock:
    day: date
    seconds: int


@dataclass
class _Round:
    count: int = 0
    clean: bool = True
    last_day: date | None = None


@dataclass
class DayStats:
    ratings: int = 0
    passes: int = 0
    conquered: int = 0
    first_learned: int = 0
    high_star: int = 0
    star3_passes: int = 0
    quiz_answered: int = 0
    quiz_correct: int = 0
    minutes: int = 0
    night: int = 0
    dawn: int = 0
    xp: dict[str, float] = field(default_factory=lambda: defaultdict(float))

    @property
    def active(self) -> bool:
        # Same definition as the exam context's cumulative study days.
        return self.ratings > 0 or self.quiz_answered > 0


def build_days(
    ratings: list[RatingEvent], quizzes: list[QuizEvent], blocks: list[StudyBlock]
) -> tuple[dict[date, DayStats], list[date]]:
    """Per-day stats and XP, plus the day each perfect round finished. ``ratings`` must be chronological."""
    days: dict[date, DayStats] = defaultdict(DayStats)
    last_rating: dict[str, int] = {}
    passed_once: set[str] = set()
    conquered_on: set[tuple[str, date]] = set()
    repeats: Counter[tuple[object, date]] = Counter()
    rounds: dict[str, _Round] = defaultdict(_Round)

    for event in ratings:
        stats = days[event.day]
        key = (event.unit_id, event.day)
        factor = repeat_factor(repeats[key])
        repeats[key] += 1
        multiplier = star_multiplier(event.stars)
        stats.ratings += 1
        stats.xp["rating"] += GRADE_XP.get(event.rating, GRADE_XP[1]) * multiplier * factor
        if event.passed:
            stats.passes += 1
        if event.stars >= 3:
            stats.high_star += 1
            if event.passed:
                stats.star3_passes += 1
        # 攻克: last seen as 忘记, now 记得/轻松. Once per unit per day, so it cannot be farmed.
        if last_rating.get(event.unit_id) == 1 and event.rating >= 3 and key not in conquered_on:
            conquered_on.add(key)
            stats.conquered += 1
            stats.xp["conquer"] += CONQUER_BONUS * multiplier
        if event.passed and event.unit_id not in passed_once:
            passed_once.add(event.unit_id)
            stats.first_learned += 1
            stats.xp["first_learn"] += FIRST_LEARN_BONUS * multiplier
        last_rating[event.unit_id] = event.rating
        if event.hour >= 23 or event.hour < 4:
            stats.night += 1
        elif 5 <= event.hour < 8:
            stats.dawn += 1
        if event.round_id:
            played = rounds[event.round_id]
            played.count += 1
            played.clean = played.clean and event.rating >= 3
            played.last_day = event.day

    for quiz in quizzes:
        stats = days[quiz.day]
        factor = 1.0
        if quiz.question_id is not None:
            question_key = (quiz.question_id, quiz.day)
            factor = repeat_factor(repeats[question_key])
            repeats[question_key] += 1
        stats.quiz_answered += 1
        stats.quiz_correct += 1 if quiz.correct else 0
        base = QUIZ_CORRECT_XP if quiz.correct else QUIZ_TRIED_XP
        stats.xp["quiz"] += base * star_multiplier(quiz.stars) * factor

    for block in blocks:
        minutes = min(SESSION_MINUTE_CAP, max(0, block.seconds) // 60)
        if minutes <= 0:
            continue
        stats = days[block.day]
        stats.minutes += minutes
        stats.xp["time"] += minutes

    perfect_days = sorted(
        played.last_day
        for played in rounds.values()
        if played.last_day and played.count >= PERFECT_ROUND_MIN and played.clean
    )
    return dict(days), perfect_days
