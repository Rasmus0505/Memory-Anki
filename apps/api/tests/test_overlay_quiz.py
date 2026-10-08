import json
from datetime import date, datetime

from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.misc import StudySession
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitEncounter,
    ReviewUnitState,
)
from memory_anki.modules.practice.application.overlay_quiz_service import (
    build_overlay_question_pack,
    build_round_question_ratings,
)
from memory_anki.modules.practice.application.round_overlay_service import (
    drop_overlay_quiz_for_palaces,
    ensure_overlay_quiz,
    progress_overlay_quiz,
)
from memory_anki.modules.practice.application.round_state_service import (
    apply_round_action,
    apply_round_rating,
    get_or_create_active_round,
    start_new_round,
)
from memory_anki.modules.practice.domain import round_plan
from memory_anki.modules.practice.domain.overlay_quiz import (
    QUESTION_RATING_NONE,
    apply_overlay_progress,
    drop_overlay_for_palaces,
    inherit_overlay_completed,
    merge_overlay_quiz,
    normalize_overlay_quiz,
    order_overlay_questions,
    overlay_quiz_scope_signature,
    pick_question_node_rating,
)
from memory_anki.modules.practice.domain.round_compress import compress_completed
from memory_anki.modules.practice.domain.round_plan import (
    apply_rating,
    complete_card,
    exclude_card,
    normalize_plan,
    plan_from_cards,
    removed_review_palace_ids,
    review_palace_ids,
)


def _seed_unit(db_session, *, palace_id: int, node_uids: list[str], unit_id: str = "unit-1") -> str:
    """One active review unit owning ``node_uids``, so ratings can resolve to it."""
    db_session.add(
        ReviewUnitState(
            id=unit_id,
            palace_id=palace_id,
            anchor_uid=node_uids[0],
            unit_kind="mark",
            node_uids_json=json.dumps(node_uids),
            membership_hash="h",
            content_hash="c",
            revision=1,
            stage_index=1,
            has_passed=True,
            due_date=date.today(),
        )
    )
    return unit_id


def _removal_config() -> dict:
    return {
        "training_mode": "memory_palace",
        "streams": {
            "memory_palace": {
                "specific_palace_ids": [],
                "subject_ids": [],
                "subject_scope": "all",
            },
            "quiz": {"question_type": "all", "quiz_scope": "cross_palace_random"},
        },
    }


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


def test_excluded_overlay_questions_stay_out_of_the_rebuilt_pack() -> None:
    existing = normalize_overlay_quiz(
        {
            "question_ids": [10, 11, 12],
            "completed_ids": [11],
            "states": {"11": {"resolved": True, "shortAnswerSubmitted": True}},
            "excluded_ids": [11],
            "scope_signature": "pack",
            "quiz_scope": "cross_palace_random",
            "seed": 1,
        }
    )
    assert existing["question_ids"] == [10, 12]
    assert existing["completed_ids"] == []
    assert "11" not in existing["states"]
    merged = merge_overlay_quiz(
        existing,
        question_ids=[10, 11, 12],
        quiz_scope="cross_palace_random",
        seed=1,
        scope_signature="pack",
        limit_reached=False,
        candidate_count=3,
    )
    assert merged["question_ids"] == [10, 12]
    assert 11 not in merged["completed_ids"]
    assert merged["excluded_ids"] == [11]


def test_same_scope_keeps_learner_order_when_the_pack_is_only_shuffled() -> None:
    existing = normalize_overlay_quiz(
        {
            "scope_signature": "pack",
            "quiz_scope": "cross_palace_random",
            "seed": 17,
            "question_ids": [1, 2, 3, 4],
            "current_index": 2,
            "completed_ids": [1, 3],
            "states": {"1": {"resolved": True}, "3": {"resolved": True}},
        }
    )
    merged = merge_overlay_quiz(
        existing,
        question_ids=[4, 3, 2, 1],
        quiz_scope="cross_palace_random",
        seed=17,
        scope_signature="pack",
        limit_reached=False,
        candidate_count=4,
    )
    assert merged["question_ids"] == [1, 2, 3, 4]
    assert merged["current_index"] == 2
    assert merged["completed_ids"] == [1, 3]


def test_scope_signature_is_stable() -> None:
    left = overlay_quiz_scope_signature([2, 1], "cross_palace_random", "all", ["weak", "unseen"], True)
    right = overlay_quiz_scope_signature([1, 2], "cross_palace_random", "all", ["unseen", "weak"], True, "due")
    assert left == right
    assert "mastery_buckets" not in left
    assert "overlay_question_range" not in left
    assert "overlay_question_kinds" in left
    changed = overlay_quiz_scope_signature(
        [1, 2],
        "cross_palace_random",
        overlay_question_kinds=["subjective"],
        overlay_type_order="subjective_then_objective",
    )
    assert changed != left


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


def test_order_overlay_questions_nests_palace_or_type() -> None:
    cards = [
        {"id": 1, "palace_id": 10, "kind": "objective"},
        {"id": 2, "palace_id": 10, "kind": "subjective"},
        {"id": 3, "palace_id": 20, "kind": "objective"},
        {"id": 4, "palace_id": 20, "kind": "subjective"},
    ]
    palace_first = [
        item["id"]
        for item in order_overlay_questions(
            cards,
            [10, 20],
            quiz_scope="single_palace_random",
            type_order="objective_then_subjective",
            nesting="palace_then_type",
            seed=17,
        )
    ]
    assert palace_first.index(1) < palace_first.index(2) < palace_first.index(3)
    assert palace_first.index(2) < palace_first.index(4)
    type_first = [
        item["id"]
        for item in order_overlay_questions(
            cards,
            [10, 20],
            quiz_scope="single_palace_random",
            type_order="subjective_then_objective",
            nesting="type_then_palace",
            seed=17,
        )
    ]
    assert type_first.index(2) < type_first.index(4) < type_first.index(1)
    assert type_first.index(4) < type_first.index(3)
    mixed = [
        item["id"]
        for item in order_overlay_questions(
            cards,
            [10, 20],
            quiz_scope="cross_palace_random",
            type_order="objective_then_subjective",
            nesting="palace_then_type",
            seed=17,
        )
    ]
    assert max(mixed.index(1), mixed.index(3)) < min(mixed.index(2), mixed.index(4))


def test_overlay_pack_counts_kinds_and_filters_without_feed_question_type(db_session) -> None:
    palace = Palace(title="题型宫殿")
    db_session.add(palace)
    db_session.flush()
    db_session.add_all(
        [
            PalaceQuizQuestion(palace_id=palace.id, stem="选择", question_type="multiple_choice"),
            PalaceQuizQuestion(palace_id=palace.id, stem="判断", question_type="true_false"),
            PalaceQuizQuestion(palace_id=palace.id, stem="简答", question_type="short_answer"),
        ]
    )
    db_session.commit()
    pack = build_overlay_question_pack(
        db_session,
        {
            "question_type": "multiple_choice",
            "overlay_question_kinds": ["subjective"],
            "overlay_type_order": "interleave",
            "streams": {"quiz": {"question_type": "multiple_choice", "quiz_scope": "cross_palace_random"}},
        },
        palace_ids=[palace.id],
    )
    assert pack["kind_counts"] == {"objective": 2, "subjective": 1}
    assert len(pack["question_ids"]) == 1
    assert pack["question_palace_ids"]
    assert set(pack["question_palace_ids"].values()) == {palace.id}


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


def test_round_payload_does_not_ship_a_dead_palace_clearance_list() -> None:
    """The payload must not carry a palace-clearance answer nobody reads.

    It used to ship `cleared_review_palace_ids` (computed with skip/exclude
    counted as handled) while the chapter banner was computed independently in
    the frontend with the opposite rule. Two answers to one question, and the
    shipped one had no consumer — an invitation to "fix" the banner by reading
    it, which would have silently changed behaviour. See
    docs/incidents/0002-quiz-scope-two-owners.md §6.
    """
    plan = plan_from_cards(
        [
            {"id": "a", "type": "mindmap_branch", "palace_id": 10, "unit_id": "u1"},
            {"id": "b", "type": "mindmap_branch", "palace_id": 10, "unit_id": "u2"},
        ]
    )
    rated = apply_rating(plan, card_id="a", rating=3, encounter_id="e1")
    both = apply_rating(rated, card_id="b", rating=4, encounter_id="e2")
    # `cleared_review_palace_ids` itself is gone from the domain module.
    assert not hasattr(round_plan, "cleared_review_palace_ids")    # The payload builder never re-introduces it.
    import inspect

    from memory_anki.modules.practice.application import round_state_payload

    source = inspect.getsource(round_state_payload)
    assert "cleared_review_palace_ids" not in source
    # Sanity: the plan really is fully handled, so the old field would have
    # returned {10} here. The assertion above is about ownership, not state.
    assert both["completed_ids"] == ["a", "b"]


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
        "memory_anki.modules.practice.application.round_overlay_service.build_overlay_question_pack",
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
        "memory_anki.modules.practice.application.round_overlay_service.build_overlay_question_pack",
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


def test_scope_report_explains_why_a_scheduled_palace_has_no_questions(db_session) -> None:
    """The 做题 header must be able to explain an empty pool.

    Regression for the live mismatch where the dialog counted 8 palaces from the
    round plan while the pool held 0 questions, with nothing telling the learner
    that the saved 随心 range was what excluded them.
    """
    subject = Subject(name="外国教育史")
    english = Subject(name="英语")
    in_scope = Palace(title="夸美纽斯", subjects=[subject])
    out_of_scope = Palace(title="英语阅读", subjects=[english])
    empty_palace = Palace(title="还没有题的宫殿", subjects=[subject])
    db_session.add_all([subject, english, in_scope, out_of_scope, empty_palace])
    db_session.flush()
    db_session.add_all(
        [
            PalaceQuizQuestion(palace_id=in_scope.id, stem="夸美纽斯题", question_type="multiple_choice"),
            PalaceQuizQuestion(palace_id=out_of_scope.id, stem="阅读题", question_type="multiple_choice"),
        ]
    )
    db_session.commit()
    config = {
        "training_mode": "memory_palace",
        "streams": {
            "memory_palace": {
                "specific_palace_ids": [],
                "subject_ids": [subject.id],
                "subject_scope": "all",
            },
            "quiz": {"question_type": "all", "quiz_scope": "cross_palace_random"},
        },
    }
    rounds_palaces = [in_scope.id, out_of_scope.id, empty_palace.id]
    pack = build_overlay_question_pack(db_session, config, palace_ids=rounds_palaces)
    scope = pack["scope_palaces"]

    # Every palace the round scheduled contributes, including the one whose
    # subject the current config no longer selects: the saved config must not
    # narrow the round's own review set a second time.
    assert pack["candidate_count"] == 2
    assert set(pack["question_palace_ids"].values()) == {in_scope.id, out_of_scope.id}
    assert scope["scheduled_count"] == 3
    assert scope["in_pool_count"] == 2
    rows = {row["palace_id"]: row for row in scope["palaces"]}
    assert rows[in_scope.id]["in_pool"] is True
    assert rows[in_scope.id]["reason"] == ""
    assert rows[out_of_scope.id]["in_pool"] is True
    assert rows[out_of_scope.id]["reason"] == ""
    assert rows[out_of_scope.id]["question_count"] == 1
    assert rows[out_of_scope.id]["title"] == "英语阅读"
    # Nothing to study here at all, and the reason names that rather than
    # sending the learner to the config.
    assert rows[empty_palace.id]["in_pool"] is False
    assert rows[empty_palace.id]["reason"] == "no_questions"
    assert rows[empty_palace.id]["question_count"] == 0


def test_scope_report_marks_kind_filtered_palaces(db_session) -> None:
    """Unselecting 主观 must be reported, not silently shrink the pool."""
    palace = Palace(title="主观题宫殿")
    db_session.add(palace)
    db_session.flush()
    db_session.add_all(
        [
            PalaceQuizQuestion(palace_id=palace.id, stem="简答", question_type="short_answer"),
            PalaceQuizQuestion(palace_id=palace.id, stem="选择", question_type="multiple_choice"),
        ]
    )
    db_session.commit()
    config = {
        "training_mode": "memory_palace",
        "overlay_question_kinds": ["objective"],
        "streams": {
            "memory_palace": {"specific_palace_ids": [], "subject_ids": [], "subject_scope": "all"},
            "quiz": {"question_type": "all", "quiz_scope": "cross_palace_random"},
        },
    }
    pack = build_overlay_question_pack(db_session, config, palace_ids=[palace.id])
    assert pack["candidate_count"] == 1
    assert pack["scope_palaces"]["in_pool_count"] == 1
    assert pack["scope_palaces"]["palaces"][0]["in_pool"] is True
    # Both kinds are still reported as available: the checkbox explains the filter.
    assert pack["scope_palaces"]["palaces"][0]["question_count"] == 2
    assert pack["scope_palaces"]["palaces"][0]["subjective"] == 1


def test_scope_report_keeps_reason_when_every_kind_is_unselected(db_session) -> None:
    """A palace whose every question is of an unselected kind says so."""
    palace = Palace(title="只有简答")
    db_session.add(palace)
    db_session.flush()
    db_session.add(PalaceQuizQuestion(palace_id=palace.id, stem="简答", question_type="short_answer"))
    db_session.commit()
    config = {
        "training_mode": "memory_palace",
        "overlay_question_kinds": ["objective"],
        "streams": {
            "memory_palace": {"specific_palace_ids": [], "subject_ids": [], "subject_scope": "all"},
            "quiz": {"question_type": "all", "quiz_scope": "cross_palace_random"},
        },
    }
    pack = build_overlay_question_pack(db_session, config, palace_ids=[palace.id])
    assert pack["candidate_count"] == 0
    row = pack["scope_palaces"]["palaces"][0]
    assert row["in_pool"] is False
    assert row["reason"] == "kinds_filtered"
    assert row["question_count"] == 1


def test_scope_report_survives_a_round_write(db_session) -> None:
    """The report is persisted on the round plan and restored, not recomputed."""
    palace = Palace(title="持久化宫殿")
    db_session.add(palace)
    db_session.flush()
    db_session.add(PalaceQuizQuestion(palace_id=palace.id, stem="题", question_type="multiple_choice"))
    db_session.commit()
    config = {
        "training_mode": "memory_palace",
        "streams": {
            "memory_palace": {"specific_palace_ids": [], "subject_ids": [], "subject_scope": "all"},
            "quiz": {"question_type": "all", "quiz_palace_scope": "cross_palace_random"},
        },
    }
    created = get_or_create_active_round(
        db_session,
        scope_key="scope-report",
        config=config,
        cards=[{"id": "a", "type": "mindmap_branch", "palace_id": palace.id, "unit_id": "unit-a"}],
        operation_id="create-scope-report",
        round_id="scope-report-round",
    )
    ensured = ensure_overlay_quiz(
        db_session,
        round_id=created["round_id"],
        operation_id="ensure-scope-report",
        expected_version=created["version"],
        config=config,
    )
    scope = ensured["plan"]["overlay_quiz"]["scope_palaces"]
    assert scope["scheduled_count"] == 1
    assert scope["palaces"][0]["title"] == "持久化宫殿"
    # A progress write must not drop it: the UI renders it on every open.
    progressed = progress_overlay_quiz(
        db_session,
        round_id=ensured["round_id"],
        operation_id="progress-scope-report",
        expected_version=ensured["version"],
        current_index=0,
        completed_ids=[],
        states={},
    )
    restored = progressed["plan"]["overlay_quiz"]["scope_palaces"]
    assert restored["scheduled_count"] == 1
    assert restored["palaces"][0]["in_pool"] is True


def test_question_node_rating_picks_the_weakest_bound_node() -> None:
    """A question binding several nodes is judged by its weakest one."""
    assert pick_question_node_rating([], {"a": 3}) is None
    assert pick_question_node_rating(["a"], {}) == QUESTION_RATING_NONE
    assert pick_question_node_rating(["a"], {"a": 4}) == 4
    # Lowest wins: the badge is a warning before answering, so the weakest
    # evidence is the useful one.
    assert pick_question_node_rating(["a", "b", "c"], {"a": 4, "b": 1, "c": 3}) == 1
    # A node outside the round's units has no rating to borrow.
    assert pick_question_node_rating(["outsider"], {"a": 2}) == QUESTION_RATING_NONE
    # Blank uids are not bindings.
    assert pick_question_node_rating(["", "   "], {"a": 2}) is None


def test_question_node_ratings_resolve_through_the_rounds_own_units(db_session) -> None:
    """The badge chain: question → bound node → round unit → this round's rating."""
    palace = Palace(title="英国近代教育")
    other = Palace(title="别的宫殿")
    db_session.add_all([palace, other])
    db_session.flush()
    inside = ReviewUnitState(
        id="unit-inside", palace_id=palace.id, anchor_uid="n1", unit_kind="mark",
        node_uids_json=json.dumps(["n1", "n2"]), membership_hash="h", content_hash="c",
        revision=1, stage_index=1, has_passed=True, due_date=date.today(),
    )
    outsider = ReviewUnitState(
        id="unit-outsider", palace_id=other.id, anchor_uid="n9", unit_kind="mark",
        node_uids_json=json.dumps(["n9"]), membership_hash="h", content_hash="c",
        revision=1, stage_index=1, has_passed=True, due_date=date.today(),
    )
    db_session.add_all([inside, outsider])
    q_a = PalaceQuizQuestion(palace_id=palace.id, stem="绑 n1")
    q_multi = PalaceQuizQuestion(palace_id=palace.id, stem="绑 n1 和 n2")
    q_outside = PalaceQuizQuestion(palace_id=palace.id, stem="绑 n9")
    q_unbound = PalaceQuizQuestion(palace_id=palace.id, stem="没绑定")
    db_session.add_all([q_a, q_multi, q_outside, q_unbound])
    db_session.flush()
    db_session.add_all(
        [
            PalaceQuizQuestionNodeBinding(question_id=q_a.id, palace_id=palace.id, node_uid="n1"),
            PalaceQuizQuestionNodeBinding(question_id=q_multi.id, palace_id=palace.id, node_uid="n1"),
            PalaceQuizQuestionNodeBinding(question_id=q_multi.id, palace_id=palace.id, node_uid="n2"),
            # Bound to a node owned by a unit outside this round: no rating to show.
            PalaceQuizQuestionNodeBinding(question_id=q_outside.id, palace_id=palace.id, node_uid="n9"),
        ]
    )
    db_session.commit()
    pack = build_overlay_question_pack(
        db_session,
        {"training_mode": "memory_palace", "streams": {"quiz": {"question_type": "all"}}},
        palace_ids=[palace.id],
        unit_ids=["unit-inside"],
        round_ratings={"unit-inside": 2, "unit-outsider": 1},
    )
    ratings = pack["question_node_ratings"]
    # n1 → unit-inside (rated 2 this round).
    assert ratings[str(q_a.id)] == 2
    # Weakest of n1/n2, both in the same rated unit.
    assert ratings[str(q_multi.id)] == 2
    # n9 belongs to a unit this round did not schedule, so the outsider's
    # rating of 1 must not leak in.
    assert str(q_outside.id) not in ratings
    # No binding at all: nothing to show.
    assert str(q_unbound.id) not in ratings


def test_question_without_a_round_rating_shows_no_score(db_session) -> None:
    """A question whose unit this round never rated must not invent a score."""
    palace = Palace(title="还没复习到")
    db_session.add(palace)
    db_session.flush()
    unit = ReviewUnitState(
        id="unit-unrated", palace_id=palace.id, anchor_uid="n1", unit_kind="mark",
        node_uids_json=json.dumps(["n1"]), membership_hash="h", content_hash="c",
        revision=1, stage_index=0, has_passed=False, due_date=date.today(),
    )
    db_session.add(unit)
    question = PalaceQuizQuestion(palace_id=palace.id, stem="题")
    db_session.add(question)
    db_session.flush()
    db_session.add(
        PalaceQuizQuestionNodeBinding(question_id=question.id, palace_id=palace.id, node_uid="n1")
    )
    db_session.commit()
    pack = build_overlay_question_pack(
        db_session,
        {"training_mode": "memory_palace", "streams": {"quiz": {"question_type": "all"}}},
        palace_ids=[palace.id],
        unit_ids=["unit-unrated"],
        round_ratings={},
    )
    # Absent, so the card renders 「本轮尚未复习」 rather than a zero.
    assert pack["question_node_ratings"] == {}


def test_removed_review_palace_ids_requires_every_card_excluded() -> None:
    """A palace leaves the round only when ALL its cards were 移除本队列."""
    plan = plan_from_cards(
        [
            {"id": "a", "type": "mindmap_branch", "palace_id": 10, "unit_id": "u1"},
            {"id": "b", "type": "mindmap_branch", "palace_id": 10, "unit_id": "u2"},
            {"id": "c", "type": "mindmap_branch", "palace_id": 20, "unit_id": "u3"},
        ]
    )
    assert removed_review_palace_ids(plan) == set()
    # One of two palace-10 cards removed: the palace is still being reviewed.
    partly = exclude_card(plan, "a")
    assert removed_review_palace_ids(partly) == set()
    # Palace 20's only card removed: that palace is gone from the round.
    whole = exclude_card(partly, "c")
    assert removed_review_palace_ids(whole) == {20}
    both = exclude_card(whole, "b")
    assert removed_review_palace_ids(both) == {10, 20}


def test_completing_a_palace_does_not_remove_its_questions() -> None:
    """Finished palaces keep their questions; only 移除本队列 takes them away.

    The product decision is that a palace you have finished reviewing stays
    available for extra practice, so completion must not look like removal.
    """
    plan = plan_from_cards(
        [{"id": "a", "type": "mindmap_branch", "palace_id": 10, "unit_id": "u1"}]
    )
    passed = apply_rating(plan, card_id="a", rating=3, encounter_id="e1")
    assert removed_review_palace_ids(passed) == set()
    completed = complete_card(passed, "a")
    assert removed_review_palace_ids(completed) == set()
    # And a compressed (小结算) card is a pass that left the feed, not a removal.
    compressed = compress_completed(completed, None)
    assert removed_review_palace_ids(compressed) == set()


def test_removed_palace_questions_leave_the_pool_and_say_why(db_session) -> None:
    """The end-to-end rule: 移除队列 a palace's cards ⇒ its questions go too.

    Live case: a round scheduled 8 palaces, and the only two holding questions
    (23 and 43) each had their single card removed. The pool must be empty and
    the report must say 「已移除队列」 rather than 「还没有题目」 — the palace has
    plenty of questions; the learner took it out.
    """
    kept = Palace(title="还在复习的宫殿")
    removed = Palace(title="整座被移除的宫殿")
    db_session.add_all([kept, removed])
    db_session.flush()
    q_kept = PalaceQuizQuestion(palace_id=kept.id, stem="保留题")
    q_removed = PalaceQuizQuestion(palace_id=removed.id, stem="被移除题")
    db_session.add_all([q_kept, q_removed])
    db_session.commit()
    pack = build_overlay_question_pack(
        db_session,
        {"training_mode": "memory_palace", "streams": {"quiz": {"question_type": "all"}}},
        palace_ids=[kept.id, removed.id],
        removed_palace_ids=[removed.id],
    )
    assert pack["question_ids"] == [q_kept.id]
    scope = pack["scope_palaces"]
    rows = {row["palace_id"]: row for row in scope["palaces"]}
    # Both palaces stay listed so the removal is visible, not silent.
    assert scope["scheduled_count"] == 2
    assert scope["in_pool_count"] == 1
    assert rows[kept.id]["in_pool"] is True
    assert rows[removed.id]["in_pool"] is False
    assert rows[removed.id]["reason"] == "palace_removed"
    # The count still shows its material: the learner can see what they gave up.
    assert rows[removed.id]["question_count"] == 1


def test_removal_reason_outranks_no_questions(db_session) -> None:
    """A removed palace never reads as「还没有题目」when it has questions."""
    palace = Palace(title="有题但被移除")
    db_session.add(palace)
    db_session.flush()
    db_session.add(PalaceQuizQuestion(palace_id=palace.id, stem="题"))
    db_session.commit()
    pack = build_overlay_question_pack(
        db_session,
        {"training_mode": "memory_palace", "streams": {"quiz": {"question_type": "all"}}},
        palace_ids=[palace.id],
        removed_palace_ids=[palace.id],
    )
    row = pack["scope_palaces"]["palaces"][0]
    assert row["reason"] == "palace_removed"
    assert row["question_count"] == 1


def test_removed_palace_answers_park_and_return_with_the_round(db_session) -> None:
    """Answered 做题 progress for a removed palace parks; it is not destroyed."""
    palace = Palace(title="移除后又回来")
    db_session.add(palace)
    db_session.flush()
    question = PalaceQuizQuestion(palace_id=palace.id, stem="题")
    db_session.add(question)
    db_session.commit()
    config = _removal_config()
    card = {
        "id": "card-1",
        "type": "mindmap_branch",
        "palace_id": palace.id,
        "unit_id": "unit-1",
    }
    created = get_or_create_active_round(
        db_session, scope_key="removal", config=config, cards=[card],
        operation_id="create", round_id="removal-round",
    )
    ensured = ensure_overlay_quiz(
        db_session, round_id=created["round_id"], operation_id="ensure",
        expected_version=created["version"], config=config,
    )
    assert ensured["plan"]["overlay_quiz"]["question_ids"] == [question.id]
    answered = progress_overlay_quiz(
        db_session, round_id=ensured["round_id"], operation_id="answer",
        expected_version=ensured["version"], completed_ids=[question.id],
        states={str(question.id): {"resolved": True}},
    )
    assert answered["plan"]["overlay_quiz"]["completed_ids"] == [question.id]
    # Now the learner removes the palace's only card from this round.
    removed = apply_round_action(
        db_session,
        round_id=answered["round_id"],
        action="exclude",
        operation_id="exclude-card",
        expected_version=answered["version"],
        card_id="card-1",
    )
    assert removed["plan"]["excluded_ids"] == ["card-1"]
    refreshed = ensure_overlay_quiz(
        db_session, round_id=removed["round_id"], operation_id="re-ensure",
        expected_version=removed["version"], config=config,
    )
    overlay = refreshed["plan"]["overlay_quiz"]
    # The question left the pool but its answer was kept, not deleted.
    assert overlay["question_ids"] == []
    assert overlay["parked"]["completed_ids"] == [question.id]
    assert overlay["parked"]["question_ids"] == [question.id]


def test_round_question_ratings_cover_questions_outside_the_pool(db_session) -> None:
    """关联题目 badges questions the 做题 pool filtered out.

    Live numbers: the round's palaces hold 235 questions while the kind-filtered
    pool holds 165. Reading a rating off the pool would leave the other 70 blank
    even when their knowledge points were rated this round.
    """
    palace = Palace(title="范围外也有题")
    db_session.add(palace)
    db_session.flush()
    # Two questions bound to the same rated node; only one is a short_answer.
    objective = PalaceQuizQuestion(palace_id=palace.id, stem="客观题")
    subjective = PalaceQuizQuestion(
        palace_id=palace.id, stem="主观题", question_type="short_answer"
    )
    db_session.add_all([objective, subjective])
    db_session.flush()
    for question in (objective, subjective):
        db_session.add(
            PalaceQuizQuestionNodeBinding(
                question_id=question.id, palace_id=palace.id, node_uid="n1"
            )
        )
    unit_id = _seed_unit(db_session, palace_id=palace.id, node_uids=["n1"])
    db_session.commit()

    ratings = build_round_question_ratings(
        db_session,
        palace_ids=[palace.id],
        unit_ids=[unit_id],
        round_ratings={unit_id: 2},
    )
    # Both questions carry the score, whatever their kind.
    assert ratings == {str(objective.id): 2, str(subjective.id): 2}
    # The overlay pool still honours the 客观-only choice, so it draws the
    # objective question alone — the badge source is deliberately wider.
    pack = build_overlay_question_pack(
        db_session,
        {
            "training_mode": "memory_palace",
            "overlay_question_kinds": ["objective"],
            "streams": {"quiz": {"question_type": "all"}},
        },
        palace_ids=[palace.id],
        unit_ids=[unit_id],
        round_ratings={unit_id: 2},
    )
    assert pack["question_ids"] == [objective.id]
    assert pack["question_node_ratings"] == {str(objective.id): 2}


def test_round_question_ratings_read_the_rounds_own_units(db_session) -> None:
    """A node owned by another round's unit cannot lend its rating."""
    palace = Palace(title="别的轮次")
    db_session.add(palace)
    db_session.flush()
    question = PalaceQuizQuestion(palace_id=palace.id, stem="题")
    db_session.add(question)
    db_session.flush()
    db_session.add(
        PalaceQuizQuestionNodeBinding(question_id=question.id, palace_id=palace.id, node_uid="n1")
    )
    unit_id = _seed_unit(db_session, palace_id=palace.id, node_uids=["n1"])
    db_session.commit()
    # The unit exists and is rated, but this round did not schedule it.
    assert (
        build_round_question_ratings(
            db_session,
            palace_ids=[palace.id],
            unit_ids=[],
            round_ratings={unit_id: 4},
        )
        == {}
    )


def test_round_unit_ratings_read_the_encounter_table_not_the_plan_cache(db_session) -> None:
    """Ratings come from review_unit_encounters, the authoritative store.

    The round plan also carries an ``encounters`` map, and on a real round it
    held 29 entries with only 3 carrying a ``rating`` field while the encounter
    table held all 29. Trusting the cache would print 「本轮尚未复习」 for
    knowledge points the learner had just scored.
    """
    from memory_anki.modules.memory.public.queries import list_round_unit_ratings

    palace = Palace(title="评分来源")
    db_session.add(palace)
    db_session.flush()
    unit = ReviewUnitState(
        id="unit-rate", palace_id=palace.id, anchor_uid="n1", unit_kind="mark",
        node_uids_json=json.dumps(["n1"]), membership_hash="h", content_hash="c",
        revision=1, stage_index=1, has_passed=True, due_date=date.today(),
    )
    db_session.add(unit)
    db_session.commit()
    # No encounters yet: no rating, and no fabricated one.
    assert list_round_unit_ratings(db_session, "round-x") == {}
    session_row = StudySession(
        id="sess-1",
        palace_id=palace.id,
        scene="review",
        started_at=datetime(2026, 10, 7, 12, 0, 0),
    )
    db_session.add(session_row)
    db_session.flush()
    db_session.add_all(
        [
            ReviewUnitEncounter(
                id="enc-1", study_session_id="sess-1", unit_id="unit-rate",
                unit_revision=1, round_id="round-x", sequence=1,
                baseline_state_json="{}", selected_rating=4, status="closed",
            ),
            ReviewUnitEncounter(
                id="enc-2", study_session_id="sess-1", unit_id="unit-rate",
                unit_revision=1, round_id="round-x", sequence=2,
                baseline_state_json="{}", selected_rating=1, status="closed",
            ),
            # A completion with no score must not become a rating.
            ReviewUnitEncounter(
                id="enc-3", study_session_id="sess-1", unit_id="unit-rate",
                unit_revision=1, round_id="round-x", sequence=3,
                baseline_state_json="{}", selected_rating=None, status="closed",
            ),
            # Another round's rating must not leak in.
            ReviewUnitEncounter(
                id="enc-4", study_session_id="sess-1", unit_id="unit-rate",
                unit_revision=1, round_id="round-other", sequence=4,
                baseline_state_json="{}", selected_rating=3, status="closed",
            ),
        ]
    )
    db_session.commit()
    # Lowest wins, and only this round counts.
    assert list_round_unit_ratings(db_session, "round-x") == {"unit-rate": 1}
    assert list_round_unit_ratings(db_session, "round-other") == {"unit-rate": 3}
    assert list_round_unit_ratings(db_session, "") == {}
