"""progression context: quality-weighted XP, levels, quests, stamps and the overview route."""

from datetime import date, datetime, timedelta

import pytest

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.progression.domain.projection import project
from memory_anki.modules.progression.domain.quests import (
    DAILY_COUNT,
    DAILY_XP,
    daily_quests,
    quest_xp_by_day,
    weekly_quest,
)
from memory_anki.modules.progression.domain.rules import (
    CONQUER_BONUS,
    FIRST_LEARN_BONUS,
    GRADE_XP,
    DayStats,
    QuizEvent,
    RatingEvent,
    StudyBlock,
    build_days,
    level_for,
    xp_for_level,
)
from memory_anki.modules.progression.presentation import router as progression_router

DAY = date(2026, 10, 5)


def rating(unit: str, grade: int, *, day: date = DAY, hour: int = 20, stars: int = 1, round_id: str | None = None):
    return RatingEvent(unit_id=unit, rating=grade, passed=grade >= 3, day=day, hour=hour, stars=stars, round_id=round_id)


def test_forgetting_still_earns_and_honest_recall_earns_more():
    days, _ = build_days([rating("a", 1), rating("b", 3)], [], [])
    xp = days[DAY].xp
    assert xp["rating"] == GRADE_XP[1] + GRADE_XP[3]
    assert xp["first_learn"] == FIRST_LEARN_BONUS


def test_conquering_a_forgotten_card_pays_once_per_day():
    events = [rating("a", 1, day=DAY - timedelta(days=1)), rating("a", 3), rating("a", 1), rating("a", 4)]
    days, _ = build_days(events, [], [])
    assert days[DAY].conquered == 1
    assert days[DAY].xp["conquer"] == CONQUER_BONUS


def test_repeating_a_card_the_same_day_has_diminishing_returns():
    days, _ = build_days([rating("a", 3), rating("a", 3), rating("a", 3), rating("a", 3)], [], [])
    assert days[DAY].xp["rating"] == pytest.approx(GRADE_XP[3] * (1 + 0.5 + 0.25 + 0.1))


def test_exam_stars_multiply_card_value():
    plain, _ = build_days([rating("a", 3)], [], [])
    key, _ = build_days([rating("a", 3, stars=3)], [], [])
    assert key[DAY].xp["rating"] > plain[DAY].xp["rating"]


def test_study_time_is_capped_per_session():
    days, _ = build_days([], [], [StudyBlock(day=DAY, seconds=5 * 3600), StudyBlock(day=DAY, seconds=30)])
    assert days[DAY].minutes == 120


def test_level_curve_is_fast_early_and_monotonic():
    assert level_for(0) == 1
    assert xp_for_level(2) < 200
    assert all(xp_for_level(n + 1) > xp_for_level(n) for n in range(1, 80))
    assert level_for(xp_for_level(12)) == 12
    assert level_for(xp_for_level(12) - 1) == 11


def test_daily_quests_are_deterministic_and_never_share_a_metric():
    first = daily_quests(DAY)
    assert first == daily_quests(DAY)
    assert len(first) == DAILY_COUNT
    assert len({quest.metric for quest in first}) == DAILY_COUNT
    assert weekly_quest(DAY) == weekly_quest(DAY + timedelta(days=1)) or DAY.weekday() == 6


def test_quest_xp_is_credited_only_when_the_target_is_met():
    stats = DayStats(ratings=40, conquered=3, high_star=10, first_learned=5, quiz_correct=5, minutes=25, passes=40)
    credited, counts = quest_xp_by_day({DAY: stats})
    assert credited[DAY] >= DAILY_COUNT * DAILY_XP
    assert counts[DAY] >= DAILY_COUNT
    assert quest_xp_by_day({DAY: DayStats()}) == ({}, {})


def test_perfect_round_needs_ten_clean_ratings():
    clean = [rating(f"u{i}", 3, round_id="r1") for i in range(10)]
    _, perfect = build_days(clean, [], [])
    assert perfect == [DAY]
    _, spoiled = build_days([*clean, rating("x", 1, round_id="r1")], [], [])
    assert spoiled == []


def test_projection_levels_up_and_unlocks_stamps_that_never_unlock_again():
    events = [rating(f"u{i}", 3, day=DAY - timedelta(days=i % 8)) for i in range(120)]
    view = project(events, [QuizEvent(question_id=1, correct=True, day=DAY)], [], today=DAY)
    assert view.level.level > 1
    assert 0 <= view.level.progress <= 1
    unlocked = {item.stamp.id: item.unlocked_on for item in view.stamps if item.unlocked_on}
    assert "ratings_100" in unlocked and "days_7" in unlocked
    later = project(events, [], [], today=DAY + timedelta(days=30))
    assert {item.stamp.id: item.unlocked_on for item in later.stamps if item.unlocked_on}["ratings_100"] == unlocked["ratings_100"]
    assert later.xp_today == 0


def _seed_rating(session, *, grade: int, created_at: datetime, sequence: int):
    palace = session.query(Palace).first() or Palace(title="线代")
    session.add(palace)
    session.flush()
    if not session.get(StudySession, "s-1"):
        session.add(StudySession(id="s-1", scene="freestyle", started_at=created_at, effective_seconds=1800))
        session.add(
            ReviewUnitState(
                id="u-1", palace_id=palace.id, anchor_uid="a", unit_kind="branch", node_uids_json="[\"a\"]",
                membership_hash="m", content_hash="c", stage_index=1, has_passed=True, due_date=date.today(),
            )
        )
        session.flush()
    encounter = ReviewUnitEncounter(
        id=f"e-{sequence}", study_session_id="s-1", unit_id="u-1", unit_revision=1, round_id="round-1",
        sequence=sequence, baseline_state_json="{}", status="closed",
    )
    session.add(encounter)
    session.flush()
    session.add(
        ReviewUnitRatingOperation(
            id=f"op-{sequence}", encounter_id=encounter.id, study_session_id="s-1", unit_id="u-1",
            palace_id=palace.id, unit_revision=1, rating=grade, passed=grade >= 3,
            before_state_json="{}", after_state_json="{}", created_at=created_at,
        )
    )
    session.commit()


def test_overview_route_projects_recorded_evidence(make_client, db_session):
    now = utc_now_naive()
    _seed_rating(db_session, grade=1, created_at=now - timedelta(days=1), sequence=1)
    _seed_rating(db_session, grade=3, created_at=now, sequence=2)
    client = make_client(progression_router)

    body = client.get("/api/v1/progression/overview").json()
    assert body["stats"]["ratings"] == 2
    assert body["stats"]["conquered"] == 1
    assert body["level"]["xp"] > 0
    assert body["xp"]["sources"]["conquer"] == CONQUER_BONUS
    assert body["xp"]["sources"]["time"] == 30
    assert len([q for q in body["quests"] if q["scope"] == "daily"]) == DAILY_COUNT
    assert any(stamp["id"] == "ratings_100" and stamp["unlocked_on"] is None for stamp in body["stamps"])
    starmap = body["starmap"]
    assert starmap["palaces"][0]["unit_count"] == 1
    assert {"subjects", "chapters", "palaces"} <= set(starmap)
    # Reading never writes.
    assert client.get("/api/v1/progression/overview").json()["level"] == body["level"]
