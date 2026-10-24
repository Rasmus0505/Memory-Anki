"""exam context: star rules, forgetting estimate, priority and routes."""

from datetime import date, datetime, timedelta

from memory_anki.core.time import local_day
from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.modules.exam.api import palace_priority_scores, resolve_stars_for_palaces
from memory_anki.modules.exam.domain.priority import (
    order_by_priority,
    palace_priority,
    share_factor,
)
from memory_anki.modules.exam.domain.retention import (
    UnitMemory,
    forgetting_degree,
    recall_probability,
)
from memory_anki.modules.exam.domain.stars import (
    SOURCE_CHAPTER,
    SOURCE_DERIVED,
    SOURCE_MANUAL,
    chapter_chain,
    derive_stars,
    resolve_palace_stars,
)
from memory_anki.modules.exam.presentation import router as exam_router


def test_derived_stars_weigh_subjective_questions_three_times():
    assert derive_stars(0, 0) == 1
    assert derive_stars(4, 0) == 1
    assert derive_stars(5, 0) == 2
    # 4 questions, 3 of them subjective: 4 + 2 * 3 = 10 -> 2 stars
    assert derive_stars(4, 3) == 2
    # 6 questions, all subjective: 6 + 12 = 18 -> 3 stars
    assert derive_stars(6, 6) == 3


def test_palace_stars_override_chapter_then_fall_back_to_questions():
    own = resolve_palace_stars(
        palace_stars=1, palace_source="manual", chapter_chain=[(7, 3)], question_count=20, subjective_count=20
    )
    assert (own.stars, own.source) == (1, SOURCE_MANUAL)

    inherited = resolve_palace_stars(
        palace_stars=None, palace_source=None, chapter_chain=[(7, None), (3, 3)], question_count=0, subjective_count=0
    )
    assert (inherited.stars, inherited.source, inherited.chapter_id) == (3, SOURCE_CHAPTER, 3)

    derived = resolve_palace_stars(
        palace_stars=None, palace_source=None, chapter_chain=[], question_count=12, subjective_count=0
    )
    assert (derived.stars, derived.source) == (3, SOURCE_DERIVED)


def test_chapter_chain_walks_to_root_and_survives_cycles():
    parents = {3: 2, 2: 1, 1: None, 9: 8, 8: 9}
    assert chapter_chain(3, parents, {1: 2}) == [(3, None), (2, None), (1, 2)]
    assert [cid for cid, _ in chapter_chain(9, parents, {})] == [9, 8]


def test_recall_hits_target_at_due_date_and_zero_when_unlearned():
    passed = UnitMemory(palace_id=1, stage_interval_days=7, has_passed=True, last_passed_at=date(2026, 1, 1))
    assert recall_probability(passed, date(2026, 1, 1)) == 1.0
    assert abs(recall_probability(passed, date(2026, 1, 8)) - 0.9) < 1e-9
    unlearned = UnitMemory(palace_id=1, stage_interval_days=0, has_passed=False, last_passed_at=None)
    assert recall_probability(unlearned, date(2026, 1, 8)) == 0.0
    assert forgetting_degree([], date(2026, 1, 8)) == 1.0


def test_priority_prefers_high_stars_and_forgotten_palaces():
    assert palace_priority(3, 0.5, 1.0) > palace_priority(1, 0.5, 1.0)
    assert palace_priority(2, 0.9, 1.0) > palace_priority(2, 0.1, 1.0)
    assert share_factor(None, 2) == share_factor(50, 2)
    assert order_by_priority([1, 2, 3], {1: 0.5, 2: 2.0, 3: 0.5}) == [2, 1, 3]


def _seed(session):
    subject = Subject(name="数学", exam_share=60)
    session.add(subject)
    session.flush()
    root = Chapter(subject_id=subject.id, name="线性代数", exam_stars=3, exam_stars_source="ai")
    session.add(root)
    session.flush()
    leaf = Chapter(subject_id=subject.id, parent_id=root.id, name="特征值")
    session.add(leaf)
    session.flush()
    inherits = Palace(title="特征值", primary_chapter_id=leaf.id)
    derived = Palace(title="行列式")
    derived.subjects = [subject]
    session.add_all([inherits, derived])
    session.flush()
    session.add_all(
        PalaceQuizQuestion(palace_id=derived.id, question_type="short_answer", lifecycle_status="published")
        for _ in range(2)
    )
    session.add(
        ReviewUnitState(
            id="u-1",
            palace_id=inherits.id,
            anchor_uid="a",
            unit_kind="branch",
            node_uids_json="[\"a\"]",
            membership_hash="m",
            content_hash="c",
            stage_index=3,
            has_passed=True,
            due_date=local_day(),
            last_passed_at=datetime.now() - timedelta(days=7),
        )
    )
    session.commit()
    return subject, root, inherits, derived


def test_star_resolution_and_priority_read_from_database(db_session):
    _, _, inherits, derived = _seed(db_session)
    stars = resolve_stars_for_palaces(db_session)
    assert stars[inherits.id] == 3
    # 2 subjective questions: 2 + 2 * 2 = 6 -> 2 stars
    assert stars[derived.id] == 2
    scores = palace_priority_scores(db_session)
    assert set(scores) == {inherits.id, derived.id}


def test_exam_routes_edit_stars_settings_and_build_overview(make_client, db_session):
    subject, root, inherits, derived = _seed(db_session)
    client = make_client(exam_router)

    response = client.put(f"/api/v1/exam/palaces/{derived.id}/stars", json={"stars": 3, "source": "manual"})
    assert response.json() == {"id": derived.id, "exam_stars": 3, "exam_stars_source": "manual"}
    cleared = client.put(f"/api/v1/exam/chapters/{root.id}/stars", json={"stars": None})
    assert cleared.json()["exam_stars"] is None and cleared.json()["exam_stars_source"] is None
    assert client.put("/api/v1/exam/palaces/999999/stars", json={"stars": 2}).status_code == 404
    assert client.put(f"/api/v1/exam/subjects/{subject.id}/share", json={"share": 150}).json()["exam_share"] == 100

    exam_day = (local_day() + timedelta(days=30)).isoformat()
    saved = client.put("/api/v1/exam/settings", json={"exam_name": "考研", "exam_date": exam_day, "subject_ids": [subject.id]})
    assert saved.json()["exam_date"] == exam_day
    assert client.put("/api/v1/exam/settings", json={"exam_date": "not-a-date"}).status_code == 400

    overview = client.get("/api/v1/exam/overview").json()
    assert overview["days_left"] == 30
    assert overview["totals"]["unit_count"] == 1
    assert overview["totals"]["learned_count"] == 1
    by_id = {row["id"]: row for row in overview["palaces"]}
    assert by_id[derived.id]["stars"] == 3
    # The chapter lost its stars, so the inheriting palace now derives 1 star from zero questions.
    assert by_id[inherits.id]["stars"] == 1
    assert [row["stars"] for row in overview["stars"]] == [3, 2, 1]
    assert len(overview["retention"]["observed"]) == 30
    assert "主观题" in overview["star_rule"]["description"]


def test_sprint_mode_caps_the_horizon_and_seeds_milestones(make_client, db_session):
    client = make_client(exam_router)
    exam_day = (local_day() + timedelta(days=58)).isoformat()

    assert client.get("/api/v1/exam/settings").json()["sprint_mode"] is False
    saved = client.put(
        "/api/v1/exam/settings",
        json={"exam_name": "考研", "exam_date": exam_day, "sprint_mode": True},
    ).json()
    assert saved["sprint_mode"] is True

    board = client.get("/api/v1/exam/milestones").json()
    assert board["sprint"]["active"] is True
    # The horizon bounds the booking: the last usable date is the exam eve, so the
    # longest gap is days_left - 1. The ladder still decides the cadence.
    assert board["sprint"]["max_interval_days"] == 57
    assert board["sprint"]["last_due"] == (date.fromisoformat(exam_day) - timedelta(days=1)).isoformat()
    # The plan's checkpoints are seeded once, not on every read.
    assert board["counts"]["total"] == len(board["items"]) > 0
    assert client.get("/api/v1/exam/milestones").json()["counts"]["total"] == board["counts"]["total"]

    items = board["items"]
    items[0]["done"] = True
    items[0]["notify_days_before"] = 5
    saved_board = client.put("/api/v1/exam/milestones", json={"items": items}).json()
    assert saved_board["items"][0]["done"] is True
    assert saved_board["items"][0]["notify_days_before"] == 5

    assert client.put("/api/v1/exam/milestones", json={"items": [{"title": "无日期"}]}).status_code == 400

    off = client.put("/api/v1/exam/settings", json={"sprint_mode": False}).json()
    assert off["sprint_mode"] is False
    assert client.get("/api/v1/exam/milestones").json()["sprint"]["active"] is False


def test_milestones_remind_exactly_twice_and_never_move_schedule(db_session):
    """Two in-app moments: the lead day, then the day itself. Overdue stays visible."""
    from memory_anki.modules.exam.application.milestone_service import (
        list_milestones,
        milestone_upcoming,
        save_milestones,
    )

    today = date(2026, 10, 23)
    save_milestones(
        db_session,
        [
            {"id": "a", "date": "2026-10-26", "title": "中教史", "notify_days_before": 3, "category": "333"},
            {"id": "b", "date": "2026-10-23", "title": "今天到期", "notify_days_before": 3},
            {"id": "c", "date": "2026-10-20", "title": "已经过期", "notify_days_before": 3},
            {"id": "d", "date": "2026-11-19", "title": "还早", "notify_days_before": 3},
        ],
    )

    board = list_milestones(db_session, today=today)
    by_id = {row["id"]: row for row in board["items"]}
    assert by_id["a"]["reminder"] == "lead"
    assert by_id["b"]["reminder"] == "today"
    assert by_id["c"]["reminder"] is None and by_id["c"]["status"] == "overdue"
    assert by_id["d"]["reminder"] is None

    # The start page shows the nearest two milestone DAYS, every item on each.
    block = milestone_upcoming(db_session, today=today)
    assert [group["date"] for group in block["groups"]] == ["2026-10-23", "2026-10-26"]
    assert [item["id"] for item in block["groups"][0]["items"]] == ["b"]
    assert [item["id"] for item in block["groups"][1]["items"]] == ["a"]
    assert block["overdue_count"] == 1
