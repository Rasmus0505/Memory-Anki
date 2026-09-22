from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.modules.practice.application.overlay_quiz_service import (
    build_overlay_question_pack,
)
from memory_anki.modules.practice.application.round_state_service import (
    apply_round_rating,
    drop_overlay_quiz_for_palaces,
    ensure_overlay_quiz,
    get_or_create_active_round,
    progress_overlay_quiz,
    start_new_round,
)
from memory_anki.modules.practice.domain.overlay_quiz import (
    apply_overlay_progress,
    drop_overlay_for_palaces,
    inherit_overlay_completed,
    merge_overlay_quiz,
    normalize_overlay_quiz,
    overlay_quiz_scope_signature,
)
from memory_anki.modules.practice.domain.round_plan import (
    apply_rating,
    cleared_review_palace_ids,
    normalize_plan,
    plan_from_cards,
    review_palace_ids,
)


def test_normalize_plan_keeps_overlay_quiz() -> None:
    plan = normalize_plan(
        {
            "original_cards": [{"card_id": "a"}],
            "overlay_quiz": {
                "question_ids": [3, 1, 3, -2],
                "current_index": 9,
                "completed_ids": [1, 99],
                "quiz_scope": "single_palace_random",
                "states": {"1": {"resolved": True}, "x": {}},
            },
        }
    )
    overlay = plan["overlay_quiz"]
    assert overlay["question_ids"] == [3, 1]
    assert overlay["current_index"] == 1
    assert overlay["completed_ids"] == [1]
    assert overlay["quiz_scope"] == "single_palace_random"
    assert overlay["states"] == {"1": {"resolved": True}}


def test_merge_keeps_progress_when_signature_matches() -> None:
    existing = normalize_overlay_quiz(
        {
            "scope_signature": "sig",
            "quiz_scope": "cross_palace_random",
            "seed": 17,
            "question_ids": [1, 2, 3],
            "current_index": 2,
            "completed_ids": [1],
            "states": {"1": {"resolved": True}},
        }
    )
    merged = merge_overlay_quiz(
        existing,
        question_ids=[1, 2, 3],
        quiz_scope="cross_palace_random",
        seed=17,
        scope_signature="sig",
        limit_reached=False,
        candidate_count=3,
    )
    assert merged["current_index"] == 2
    assert merged["completed_ids"] == [1]


def test_merge_keeps_completed_and_reorders_unstarted() -> None:
    existing = normalize_overlay_quiz(
        {
            "scope_signature": "old",
            "quiz_scope": "cross_palace_random",
            "seed": 1,
            "question_ids": [1, 2, 3, 4],
            "completed_ids": [2, 1],
            "states": {"1": {"resolved": True}, "2": {"resolved": True}},
        }
    )
    merged = merge_overlay_quiz(
        existing,
        question_ids=[4, 3, 2, 5],
        quiz_scope="single_palace_random",
        seed=2,
        scope_signature="new",
        limit_reached=False,
        candidate_count=4,
    )
    assert merged["question_ids"] == [2, 4, 3, 5]
    assert merged["completed_ids"] == [2]
    assert merged["current_index"] == 1
    assert merged["parked"]["question_ids"] == [1]
    assert merged["parked"]["completed_ids"] == [1]
    assert merged["parked"]["states"] == {"1": {"resolved": True}}


def test_apply_overlay_progress_clamps_to_membership() -> None:
    overlay = normalize_overlay_quiz({"question_ids": [10, 11], "current_index": 0})
    next_overlay = apply_overlay_progress(
        overlay,
        current_index=1,
        completed_ids=[11, 99],
        states={"11": {"resolved": True, "correct": False}, "99": {"resolved": True}},
    )
    assert next_overlay["current_index"] == 1
    assert next_overlay["completed_ids"] == [11]
    assert "99" not in next_overlay["states"]


def test_scope_signature_is_stable() -> None:
    left = overlay_quiz_scope_signature([2, 1], "cross_palace_random", "all", ["weak", "unseen"], True)
    right = overlay_quiz_scope_signature([1, 2], "cross_palace_random", "all", ["unseen", "weak"], True, "due")
    assert left == right
    assert "mastery_buckets" not in left
    assert "overlay_question_range" not in left


def test_merge_parks_out_of_scope_progress_and_restores_it() -> None:
    existing = normalize_overlay_quiz(
        {
            "scope_signature": "all",
            "quiz_scope": "cross_palace_random",
            "seed": 1,
            "question_ids": [101, 102, 201],
            "completed_ids": [101, 102],
            "states": {"101": {"resolved": True}, "102": {"resolved": True}},
            "question_palace_ids": {"101": 10, "102": 10, "201": 20},
        }
    )
    english_only = merge_overlay_quiz(
        existing,
        question_ids=[201, 202],
        quiz_scope="cross_palace_random",
        seed=2,
        scope_signature="english",
        limit_reached=False,
        candidate_count=2,
        question_palace_ids={"201": 20, "202": 20},
    )
    assert 101 not in english_only["question_ids"]
    assert english_only["parked"]["completed_ids"] == [101, 102]
    assert english_only["parked"]["states"]["101"] == {"resolved": True}

    restored = merge_overlay_quiz(
        english_only,
        question_ids=[101, 102, 201],
        quiz_scope="cross_palace_random",
        seed=1,
        scope_signature="all",
        limit_reached=False,
        candidate_count=3,
        question_palace_ids={"101": 10, "102": 10, "201": 20},
    )
    assert restored["completed_ids"] == [101, 102]
    assert restored["question_ids"][:2] == [101, 102]
    assert restored["parked"]["completed_ids"] == []
    assert restored["states"]["101"] == {"resolved": True}


def test_apply_overlay_progress_keeps_parked() -> None:
    overlay = normalize_overlay_quiz(
        {
            "question_ids": [201],
            "completed_ids": [],
            "parked": {
                "question_ids": [101],
                "completed_ids": [101],
                "states": {"101": {"resolved": True}},
            },
            "question_palace_ids": {"101": 10, "201": 20},
        }
    )
    next_overlay = apply_overlay_progress(
        overlay,
        current_index=0,
        completed_ids=[201],
        states={"201": {"resolved": True}},
    )
    assert next_overlay["completed_ids"] == [201]
    assert next_overlay["parked"]["completed_ids"] == [101]


def test_drop_overlay_for_palaces_removes_visible_and_parked() -> None:
    overlay = normalize_overlay_quiz(
        {
            "question_ids": [201, 202],
            "completed_ids": [201],
            "states": {"201": {"resolved": True}},
            "parked": {
                "question_ids": [101],
                "completed_ids": [101],
                "states": {"101": {"resolved": True}},
            },
            "question_palace_ids": {"101": 10, "201": 20, "202": 20},
        }
    )
    dropped = drop_overlay_for_palaces(overlay, {10})
    assert dropped["parked"]["question_ids"] == []
    assert dropped["question_ids"] == [201, 202]
    assert dropped["completed_ids"] == [201]
    cleared = drop_overlay_for_palaces(overlay, {10, 20})
    assert cleared["question_ids"] == []
    assert cleared["completed_ids"] == []
    assert cleared["parked"]["question_ids"] == []


def test_review_palace_ids_follow_scheduled_mindmap_cards() -> None:
    plan = plan_from_cards(
        [
            {"id": "a", "type": "mindmap_branch", "palace_id": 39, "unit_id": "u1"},
            {"id": "b", "type": "mindmap_branch", "palace_id": 39, "unit_id": "u2"},
            {"id": "q", "type": "quiz_question", "palace_id": 61, "unit_id": ""},
            {"id": "c", "type": "mindmap_branch", "palace_id": 42, "unit_id": "u3"},
        ]
    )
    assert review_palace_ids(plan) == [39, 42]
    assert review_palace_ids(plan_from_cards([])) == []


def test_overlay_pack_ignores_subject_palaces_outside_the_round(db_session) -> None:
    subject = Subject(name="外国教育史")
    in_round = Palace(title="第一节 夸美纽斯的教育思想", subjects=[subject])
    outside = Palace(title="第二节现代欧美教育思潮", subjects=[subject])
    db_session.add_all([subject, in_round, outside])
    db_session.flush()
    db_session.add_all(
        [
            PalaceQuizQuestion(palace_id=in_round.id, stem="夸美纽斯题"),
            PalaceQuizQuestion(palace_id=outside.id, stem="永恒主义题"),
        ]
    )
    db_session.commit()
    pack = build_overlay_question_pack(
        db_session,
        {
            "training_mode": "memory_palace",
            "streams": {
                "quiz": {
                    "specific_palace_ids": [],
                    "subject_ids": [subject.id],
                    "subject_scope": "all",
                    "question_type": "all",
                    "quiz_scope": "cross_palace_random",
                },
                "memory_palace": {
                    "specific_palace_ids": [],
                    "subject_ids": [subject.id],
                    "subject_scope": "all",
                },
            },
            "subject_ids": [subject.id],
            "specific_palace_ids": [],
        },
        palace_ids=[in_round.id],
    )
    assert pack["question_palace_ids"]
    assert set(pack["question_palace_ids"].values()) == {in_round.id}
    assert outside.id not in pack["question_palace_ids"].values()


def test_cleared_review_palace_ids_requires_all_units_rated() -> None:
    plan = plan_from_cards(
        [
            {"id": "a", "type": "mindmap_branch", "palace_id": 10, "unit_id": "u1"},
            {"id": "b", "type": "mindmap_branch", "palace_id": 10, "unit_id": "u2"},
            {"id": "c", "type": "mindmap_branch", "palace_id": 20, "unit_id": "u3"},
        ]
    )
    assert cleared_review_palace_ids(plan) == set()
    after_one = apply_rating(plan, card_id="a", rating=3, encounter_id="e1")
    assert cleared_review_palace_ids(after_one) == set()
    after_both = apply_rating(after_one, card_id="b", rating=4, encounter_id="e2")
    assert cleared_review_palace_ids(after_both) == {10}


def test_failed_rating_does_not_clear_palace() -> None:
    plan = plan_from_cards(
        [{"id": "a", "type": "mindmap_branch", "palace_id": 10, "unit_id": "u1"}]
    )
    failed = apply_rating(plan, card_id="a", rating=1, encounter_id="e1", round_id="r1")
    assert cleared_review_palace_ids(failed) == set()


def _cards(*ids: str, palace_id: int = 10) -> list[dict]:
    return [
        {
            "id": card_id,
            "type": "mindmap_branch",
            "label": card_id,
            "palace_id": palace_id,
            "unit_id": f"unit-{card_id}",
        }
        for card_id in ids
    ]


def test_start_new_round_clears_overlay_progress(db_session, monkeypatch) -> None:
    all_pack = {
        "question_ids": [101, 102, 201],
        "quiz_scope": "cross_palace_random",
        "seed": 1,
        "scope_signature": "all",
        "limit_reached": False,
        "candidate_count": 3,
        "question_palace_ids": {"101": 10, "102": 10, "201": 20},
    }
    english_pack = {
        "question_ids": [201],
        "quiz_scope": "cross_palace_random",
        "seed": 2,
        "scope_signature": "english",
        "limit_reached": False,
        "candidate_count": 1,
        "question_palace_ids": {"201": 20},
    }
    packs = {"current": all_pack}
    monkeypatch.setattr(
        "memory_anki.modules.practice.application.round_state_service.build_overlay_question_pack",
        lambda session, config, **_kwargs: packs["current"],
    )

    first = get_or_create_active_round(
        db_session,
        scope_key="all",
        config={},
        cards=_cards("a", "b"),
        operation_id="op-create",
        round_id="round-all",
    )
    ensure_overlay_quiz(
        db_session,
        round_id=first["round_id"],
        operation_id="op-ensure-1",
        expected_version=first["version"],
        config={},
    )
    progressed = progress_overlay_quiz(
        db_session,
        round_id=first["round_id"],
        operation_id="op-progress",
        expected_version=0,
        current_index=1,
        completed_ids=[101, 102],
        states={"101": {"resolved": True}, "102": {"resolved": True}},
    )
    assert progressed["plan"]["overlay_quiz"]["completed_ids"] == [101, 102]

    packs["current"] = english_pack
    english = start_new_round(
        db_session,
        scope_key="english",
        config={},
        cards=_cards("en-a", palace_id=20),
        operation_id="op-english",
        round_id="round-en",
    )
    ensured_en = ensure_overlay_quiz(
        db_session,
        round_id=english["round_id"],
        operation_id="op-ensure-en",
        expected_version=english["version"],
        config={},
    )
    overlay_en = ensured_en["plan"]["overlay_quiz"]
    assert overlay_en["completed_ids"] == []
    assert overlay_en["parked"]["completed_ids"] == []
    assert overlay_en["question_ids"] == [201]

    packs["current"] = all_pack
    restored = start_new_round(
        db_session,
        scope_key="all",
        config={},
        cards=_cards("a", "b"),
        operation_id="op-back",
        round_id="round-all-2",
    )
    ensured_back = ensure_overlay_quiz(
        db_session,
        round_id=restored["round_id"],
        operation_id="op-ensure-back",
        expected_version=restored["version"],
        config={},
    )
    overlay_back = ensured_back["plan"]["overlay_quiz"]
    assert overlay_back["completed_ids"] == []
    assert overlay_back["states"].get("101") in (None, {})


def test_inherit_overlay_completed_copies_states() -> None:
    current = normalize_overlay_quiz(
        {
            "question_ids": [101, 102],
            "completed_ids": [],
            "states": {},
            "question_palace_ids": {"101": 10, "102": 10},
        }
    )
    peer = normalize_overlay_quiz(
        {
            "question_ids": [101],
            "completed_ids": [101],
            "states": {"101": {"resolved": True, "selectedOptionId": "A"}},
            "question_palace_ids": {"101": 10},
        }
    )
    inherited = inherit_overlay_completed(current, peer)
    assert inherited["completed_ids"] == [101]
    assert inherited["states"]["101"]["selectedOptionId"] == "A"


def test_rating_last_unit_keeps_overlay_until_explicit_drop(db_session, monkeypatch) -> None:
    monkeypatch.setattr(
        "memory_anki.modules.practice.application.round_state_service.build_overlay_question_pack",
        lambda session, config, **_kwargs: {
            "question_ids": [101, 201],
            "quiz_scope": "cross_palace_random",
            "seed": 1,
            "scope_signature": "all",
            "limit_reached": False,
            "candidate_count": 2,
            "question_palace_ids": {"101": 10, "201": 20},
        },
    )
    created = get_or_create_active_round(
        db_session,
        scope_key="all",
        config={},
        cards=_cards("a", "b") + _cards("c", palace_id=20),
        operation_id="op-create",
        round_id="round-rate",
    )
    ensure_overlay_quiz(
        db_session,
        round_id=created["round_id"],
        operation_id="op-ensure",
        expected_version=created["version"],
        config={},
    )
    progress_overlay_quiz(
        db_session,
        round_id=created["round_id"],
        operation_id="op-progress",
        expected_version=0,
        current_index=0,
        completed_ids=[101],
        states={"101": {"resolved": True}},
    )
    apply_round_rating(
        db_session,
        round_id=created["round_id"],
        operation_id="op-rate-a",
        expected_version=0,
        card_id="a",
        occurrence_id="",
        encounter_id="e-a",
        rating=3,
        unit_id="unit-a",
        unit_revision=1,
    )
    after_both = apply_round_rating(
        db_session,
        round_id=created["round_id"],
        operation_id="op-rate-b",
        expected_version=0,
        card_id="b",
        occurrence_id="",
        encounter_id="e-b",
        rating=4,
        unit_id="unit-b",
        unit_revision=1,
    )
    assert after_both["cleared_review_palace_ids"] == [10]
    overlay = after_both["plan"]["overlay_quiz"]
    assert overlay["completed_ids"] == [101]
    assert overlay["states"]["101"]["resolved"] is True

    dropped = drop_overlay_quiz_for_palaces(
        db_session,
        round_id=created["round_id"],
        operation_id="op-drop",
        expected_version=after_both["version"],
        palace_ids=[10],
    )
    overlay_after = dropped["plan"]["overlay_quiz"]
    assert 101 not in overlay_after["completed_ids"]
    assert "101" not in overlay_after["question_palace_ids"]
    assert overlay_after["question_ids"] == [201]
