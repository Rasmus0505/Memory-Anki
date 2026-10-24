"""Pure tests for the freestyle queue's review-unit projection boundary."""

from __future__ import annotations

from datetime import date, datetime

from memory_anki.modules.practice.domain.feed_config import (
    queue_construction_signature,
    sanitize_feed_config,
)
from memory_anki.modules.practice.domain.leftover_due import (
    leftover_due_by_palace,
    merge_leftover_due,
)
from memory_anki.modules.practice.domain.queue_builder import (
    QuizCandidate,
    arrange_new_and_review,
    assemble_queue,
    attach_questions_to_units,
    merge_content_streams,
    omit_restored_ids,
    unit_key,
)
from memory_anki.modules.practice.domain.review_units import (
    ReviewUnitCandidate,
    context_path_including_anchor,
)


def test_omit_restored_ids_drops_stale_client_lists() -> None:
    completed, hidden = omit_restored_ids(["back", "keep"], ["back", "other"], ["back"])

    assert completed == ["keep"]
    assert hidden == ["other"]
    assert omit_restored_ids(["keep"], ["other"], []) == (["keep"], ["other"])


def _unit(
    anchor_uid: str,
    node_uids: tuple[str, ...],
    *,
    palace_id: int = 1,
    unit_id: str | None = None,
    revision: int = 1,
    topology_order: int = 0,
) -> ReviewUnitCandidate:
    return ReviewUnitCandidate(
        palace_id=palace_id,
        anchor_uid=anchor_uid,
        context_path=(),
        node_uids=node_uids,
        unit_id=unit_id or f"unit-{anchor_uid}",
        revision=revision,
        topology_order=topology_order,
    )


def _assemble(
    *,
    units: list[ReviewUnitCandidate],
    due_uids: set[str],
    quizzes: list[QuizCandidate] | None = None,
    config: dict | None = None,
    completed_ids: list[str] | None = None,
):
    return assemble_queue(
        config=sanitize_feed_config(
            config
            or {
                "content": {
                    "mindmap_branch": True,
                    "anki_card": False,
                    "quiz_question": False,
                },
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            }
        ),
        palace_meta={1: {"title": "Test Palace"}},
        units_by_palace={1: units},
        due_by_palace={1: due_uids},
        quizzes=quizzes or [],
        completed_ids=completed_ids or [],
    )


def test_bound_question_attaches_to_the_mark_unit_that_owns_its_node():
    residual = ReviewUnitCandidate(
        palace_id=1,
        anchor_uid="A",
        context_path=(),
        node_uids=("B3",),
        unit_id="residual",
        revision=1,
        unit_kind="residual",
    )
    branch = _unit("B1", ("B1", "C1"), unit_id="branch")
    quiz = QuizCandidate(
        question_id=7,
        palace_id=1,
        bound_node_uids=("B1",),
        mastery_score=0,
        mastery_label="unseen",
        question={"id": 7},
    )
    attached, unbound = attach_questions_to_units([residual, branch], [quiz])
    assert unbound == []
    assert attached[unit_key(residual)] == []
    assert [item.question_id for item in attached[unit_key(branch)]] == [7]


def test_queue_emits_only_due_review_units_with_stable_identity():
    due = _unit("a", ("a", "a1"), unit_id="review-a", revision=4)
    future = _unit("b", ("b", "b1"), unit_id="review-b", revision=2)

    result = _assemble(units=[due, future], due_uids={"a", "a1"})

    assert [card["id"] for card in result.cards] == ["review_unit:review-a:r4"]
    assert result.cards[0]["unit_id"] == "review-a"
    assert result.cards[0]["unit_revision"] == 4
    assert result.cards[0]["node_uids"] == ["a", "a1"]
    assert "due_node_uids" not in result.cards[0]


def test_queue_schedules_every_due_palace_unit_without_truncating():
    result = _assemble(
        units=[
            _unit("a", ("a",), unit_id="review-a"),
            _unit("b", ("b",), unit_id="review-b"),
            _unit("c", ("c",), unit_id="review-c"),
            _unit("d", ("d",), unit_id="review-d"),
            _unit("e", ("e",), unit_id="review-e"),
            _unit("f", ("f",), unit_id="review-f"),
        ],
        due_uids={"a", "b", "c", "d", "e", "f"},
        config={
            "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
            "mix_mode": "mindmap_only",
            "due_policy": "due_only",
            "queue_length": 5,
        },
    )
    assert len(result.cards) == 6
    assert result.phase_stats["candidate_count"] == 6
    assert result.phase_stats["scheduled_count"] == 6
    assert result.phase_stats["palace_leftover_due"] == {}
    assert "ratable_node_uids" not in result.cards[0]


def test_leftover_due_counts_only_unscheduled_due_review_units():
    remaining = [
        {"id": "a", "type": "mindmap_branch", "phase": "due", "unit_id": "u-a", "palace_id": 1},
        {"id": "b", "type": "mindmap_branch", "phase": "due", "unit_id": "u-b", "palace_id": 1},
        {"id": "c", "type": "mindmap_branch", "phase": "fill", "unit_id": "u-c", "palace_id": 1},
        {"id": "d", "type": "quiz_question", "phase": "due", "palace_id": 1},
        {"id": "e", "type": "mindmap_branch", "phase": "due", "unit_id": "u-e", "palace_id": 2},
    ]
    scheduled = [remaining[0]]
    assert leftover_due_by_palace(remaining, scheduled) == {"1": 1, "2": 1}
    assert merge_leftover_due({"1": 1}, {"1": 2, "3": 4}) == {"1": 3, "3": 4}


def test_queue_keeps_every_due_palace_without_a_leftover_cut():
    result = assemble_queue(
        config=sanitize_feed_config(
            {
                "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "palace_order": "finish_palace_then_next",
                "queue_length": 5,
            }
        ),
        palace_meta={1: {"title": "A"}, 2: {"title": "B"}},
        units_by_palace={
            1: [_unit("a", ("a",), palace_id=1, unit_id="u-a"), _unit("b", ("b",), palace_id=1, unit_id="u-b"), _unit("c", ("c",), palace_id=1, unit_id="u-c")],
            2: [_unit("d", ("d",), palace_id=2, unit_id="u-d"), _unit("e", ("e",), palace_id=2, unit_id="u-e"), _unit("f", ("f",), palace_id=2, unit_id="u-f")],
        },
        due_by_palace={1: {"a", "b", "c"}, 2: {"d", "e", "f"}},
        quizzes=[],
    )
    assert len(result.cards) == 6
    assert result.phase_stats["palace_leftover_due"] == {}


def test_three_stream_ratio_merge_is_stable_and_deduplicates_card_ids():
    streams = {
        "memory_palace": [{"id": "m1"}, {"id": "shared"}],
        "quiz": [{"id": "q1"}, {"id": "shared"}],
        "english": [{"id": "e1"}],
    }
    kwargs = {
        "active_streams": ["memory_palace", "quiz", "english"],
        "strategy": "ratio",
        "ratios": {"memory_palace": 2, "quiz": 1, "english": 1},
        "seed": 17,
    }
    first = merge_content_streams(streams, **kwargs)
    second = merge_content_streams(streams, **kwargs)

    assert [card["id"] for card in first] == ["m1", "shared", "q1", "e1"]
    assert [card["id"] for card in second] == [card["id"] for card in first]
    assert len({card["id"] for card in first}) == len(first)


def test_three_stream_random_and_sequential_strategies_are_supported():
    streams = {
        "memory_palace": [{"id": "m1"}, {"id": "m2"}],
        "quiz": [{"id": "q1"}],
        "english": [{"id": "e1"}],
    }
    random_kwargs = {
        "active_streams": ["memory_palace", "quiz", "english"],
        "strategy": "random",
        "ratios": {},
        "seed": 23,
    }
    random_first = merge_content_streams(streams, **random_kwargs)
    random_second = merge_content_streams(streams, **random_kwargs)
    sequential = merge_content_streams(
        streams,
        active_streams=["memory_palace", "quiz", "english"],
        strategy="sequential",
        ratios={},
        seed=23,
    )

    assert [card["id"] for card in random_first] == [card["id"] for card in random_second]
    assert set(card["id"] for card in random_first) == {"m1", "m2", "q1", "e1"}
    assert [card["id"] for card in sequential] == ["m1", "m2", "q1", "e1"]


def test_sanitize_migrates_legacy_directions_and_removes_anki():
    assert sanitize_feed_config({"mix_mode": "quiz_only"})["training_mode"] == "quiz"
    assert sanitize_feed_config({
        "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
    })["training_mode"] == "memory_palace"
    english = sanitize_feed_config({
        "subject_scope": "english",
        "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
    })
    assert english["training_mode"] == "memory_palace"
    assert english["mixed_modes"] == ["memory_palace"]
    assert english["streams"]["memory_palace"]["subject_scope"] == "english"
    migrated = sanitize_feed_config({
        "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": True},
    })
    assert migrated["training_mode"] == "mixed"
    assert migrated["mixed_modes"] == ["memory_palace", "quiz"]
    assert migrated["content"]["anki_card"] is False
    folded = sanitize_feed_config({
        "training_mode": "english",
        "streams": {"english": {"due_policy": "due_only", "unit_order": "random"}},
    })
    assert folded["training_mode"] == "memory_palace"
    assert "due_policy" not in folded["streams"]["memory_palace"]
    assert folded["streams"]["memory_palace"]["unit_order"] == "random"
    mixed_english = sanitize_feed_config({
        "training_mode": "mixed",
        "mixed_modes": ["english", "quiz"],
    })
    assert mixed_english["mixed_modes"] == ["memory_palace", "quiz"]
    assert mixed_english["streams"]["memory_palace"]["subject_scope"] == "english"
    ids_win = sanitize_feed_config({
        "training_mode": "memory_palace",
        "streams": {"memory_palace": {"subject_ids": [3], "subject_scope": "english"}},
    })
    assert ids_win["streams"]["memory_palace"]["subject_ids"] == [3]
    assert ids_win["streams"]["memory_palace"]["subject_scope"] == "all"


def test_bound_quiz_follows_owning_review_unit():
    first = _unit("a", ("a", "a1"))
    second = _unit("b", ("b", "b1"))
    quizzes = [
        QuizCandidate(21, 1, ("a1",), 0.1, "weak", {"id": 21, "palace_id": 1}),
        QuizCandidate(22, 1, ("b1",), 0.1, "weak", {"id": 22, "palace_id": 1}),
    ]

    result = _assemble(
        units=[first, second],
        due_uids={"a", "a1", "b", "b1"},
        quizzes=quizzes,
        config={
            "content": {
                "mindmap_branch": True,
                "anki_card": False,
                "quiz_question": True,
            },
            "mix_mode": "sequential_map_quiz",
            "bound_quiz_placement": "follow_unit",
            "due_policy": "due_only",
            "queue_length": 20,
        },
    )

    assert [card["id"] for card in result.cards] == [
        "review_unit:unit-a:r1",
        "quiz_question:21",
        "review_unit:unit-b:r1",
        "quiz_question:22",
    ]


def test_completed_unit_is_filtered_by_revisioned_card_id():
    unit = _unit("a", ("a",), unit_id="review-a", revision=7)
    result = _assemble(
        units=[unit],
        due_uids={"a"},
        completed_ids=["review_unit:review-a:r7"],
    )
    assert result.cards == []


def test_same_round_completed_unit_hides_newer_revision():
    unit = _unit("a", ("a",), unit_id="review-a", revision=8)
    result = _assemble(
        units=[unit],
        due_uids={"a"},
        completed_ids=["review_unit:review-a:r7"],
    )
    assert result.cards == []


def test_new_round_without_completed_ids_still_emits_new_revision():
    unit = _unit("a", ("a",), unit_id="review-a", revision=8)
    result = _assemble(
        units=[unit],
        due_uids={"a"},
        completed_ids=[],
    )
    assert [card["id"] for card in result.cards] == ["review_unit:review-a:r8"]


def test_mix_ratio_includes_bound_quizzes_when_into_mix():
    """Bound quizzes must participate in N:M so the free stream is not empty."""
    units = [
        _unit("a", ("a", "a1"), unit_id="u-a"),
        _unit("b", ("b", "b1"), unit_id="u-b"),
        _unit("c", ("c", "c1"), unit_id="u-c"),
        _unit("d", ("d", "d1"), unit_id="u-d"),
    ]
    quizzes = [
        QuizCandidate(101, 1, ("a1",), 0.1, "weak", {"id": 101, "palace_id": 1}),
        QuizCandidate(102, 1, ("b1",), 0.1, "weak", {"id": 102, "palace_id": 1}),
        QuizCandidate(103, 1, ("c1",), 0.1, "unseen", {"id": 103, "palace_id": 1}),
        QuizCandidate(104, 1, ("d1",), 0.1, "unseen", {"id": 104, "palace_id": 1}),
    ]
    result = _assemble(
        units=units,
        due_uids={"a", "a1", "b", "b1", "c", "c1", "d", "d1"},
        quizzes=quizzes,
        config={
            "content": {
                "mindmap_branch": True,
                "anki_card": False,
                "quiz_question": True,
            },
            "mix_mode": "ratio",
            "mix_ratio": {"mindmap": 2, "quiz": 1},
            "bound_quiz_placement": "into_mix",
            "due_policy": "due_only",
            "quiz_mastery_buckets": ["unseen", "weak", "reinforce"],
            "queue_length": 20,
            "seed": 7,
        },
    )
    types = [card["type"] for card in result.cards]
    assert types.count("mindmap_branch") == 4
    assert types.count("quiz_question") == 2
    prefix = types[:6]
    assert prefix.count("mindmap_branch") == 4
    assert prefix.count("quiz_question") == 2


def test_quiz_membership_includes_stable_questions():
    unit = _unit("a", ("a", "a1"))
    quizzes = [
        QuizCandidate(1, 1, (), 0.9, "stable", {"id": 1, "palace_id": 1}),
        QuizCandidate(2, 1, (), 0.1, "unseen", {"id": 2, "palace_id": 1}),
        QuizCandidate(3, 1, (), 0.2, "weak", {"id": 3, "palace_id": 1}),
    ]
    result = _assemble(
        units=[unit],
        due_uids={"a", "a1"},
        quizzes=quizzes,
        config={
            "content": {
                "mindmap_branch": True,
                "anki_card": False,
                "quiz_question": True,
            },
            "mix_mode": "quiz_only",
            "quiz_mastery_buckets": ["unseen", "weak", "reinforce"],
            "queue_length": 20,
        },
    )
    ids = [card["id"] for card in result.cards]
    assert "quiz_question:1" in ids
    assert "quiz_question:2" in ids
    assert "quiz_question:3" in ids


def test_quiz_membership_ignores_mastery_bucket_filter():
    unit = _unit("a", ("a",))
    quizzes = [
        QuizCandidate(1, 1, (), 0.1, "weak", {"id": 1, "palace_id": 1}),
        QuizCandidate(2, 1, (), 0.35, "unseen", {"id": 2, "palace_id": 1}),
    ]
    result = _assemble(
        units=[unit],
        due_uids={"a"},
        quizzes=quizzes,
        config={
            "content": {
                "mindmap_branch": False,
                "anki_card": False,
                "quiz_question": True,
            },
            "mix_mode": "quiz_only",
            "quiz_mastery_buckets": ["unseen"],
            "queue_length": 10,
        },
    )
    assert {card["id"] for card in result.cards} == {"quiz_question:1", "quiz_question:2"}


def test_single_palace_quiz_scope_keeps_palace_blocks():
    units = [
        _unit("a", ("a",), palace_id=1, unit_id="u1"),
        _unit("b", ("b",), palace_id=2, unit_id="u2"),
    ]
    quizzes = [
        QuizCandidate(11, 1, (), 0.1, "unseen", {"id": 11, "palace_id": 1}),
        QuizCandidate(12, 1, (), 0.1, "unseen", {"id": 12, "palace_id": 1}),
        QuizCandidate(21, 2, (), 0.1, "unseen", {"id": 21, "palace_id": 2}),
        QuizCandidate(22, 2, (), 0.1, "unseen", {"id": 22, "palace_id": 2}),
    ]
    result = assemble_queue(
        config=sanitize_feed_config(
            {
                "content": {
                    "mindmap_branch": False,
                    "anki_card": False,
                    "quiz_question": True,
                },
                "mix_mode": "quiz_only",
                "quiz_scope": "single_palace_random",
                "quiz_mastery_buckets": ["unseen", "weak", "reinforce"],
                "palace_order": "finish_palace_then_next",
                "queue_length": 20,
                "seed": 3,
            }
        ),
        palace_meta={1: {"title": "Palace A"}, 2: {"title": "Palace B"}},
        units_by_palace={1: [units[0]], 2: [units[1]]},
        due_by_palace={1: {"a"}, 2: {"b"}},
        quizzes=quizzes,
    )
    ids = [card["id"] for card in result.cards]
    # All palace-1 quizzes appear contiguously before palace-2 (order within palace may shuffle).
    first_block = ids[:2]
    second_block = ids[2:]
    assert set(first_block) == {"quiz_question:11", "quiz_question:12"}
    assert set(second_block) == {"quiz_question:21", "quiz_question:22"}


def _palace_units(palace_id: int, anchors: tuple[str, ...]) -> list[ReviewUnitCandidate]:
    return [
        _unit(
            anchor,
            (anchor,),
            palace_id=palace_id,
            unit_id=f"u-{palace_id}-{anchor}",
            topology_order=index,
        )
        for index, anchor in enumerate(anchors)
    ]


def test_interleave_round_robins_palaces_instead_of_finishing_one():
    sequential = assemble_queue(
        config=sanitize_feed_config(
            {
                "training_mode": "memory_palace",
                "streams": {
                    "memory_palace": {
                        "palace_order": "finish_palace_then_next",
                        "unit_order": "structured",
                        "due_policy": "due_only",
                    }
                },
                "queue_length": 20,
            }
        ),
        palace_meta={1: {"title": "A"}, 2: {"title": "B"}},
        units_by_palace={
            1: _palace_units(1, ("a", "b")),
            2: _palace_units(2, ("d", "e")),
        },
        due_by_palace={1: {"a", "b"}, 2: {"d", "e"}},
        quizzes=[],
    )
    interleaved = assemble_queue(
        config=sanitize_feed_config(
            {
                "training_mode": "memory_palace",
                "streams": {
                    "memory_palace": {
                        "palace_order": "interleave_palaces",
                        "unit_order": "structured",
                        "due_policy": "due_only",
                    }
                },
                "queue_length": 20,
            }
        ),
        palace_meta={1: {"title": "A"}, 2: {"title": "B"}},
        units_by_palace={
            1: _palace_units(1, ("a", "b")),
            2: _palace_units(2, ("d", "e")),
        },
        due_by_palace={1: {"a", "b"}, 2: {"d", "e"}},
        quizzes=[],
    )
    sequential_palaces = [card["palace_id"] for card in sequential.cards]
    interleaved_palaces = [card["palace_id"] for card in interleaved.cards]
    assert sequential_palaces == [1, 1, 2, 2]
    assert interleaved_palaces in ([1, 2, 1, 2], [2, 1, 2, 1])


def test_random_unit_order_is_stable_for_a_seed_and_differs_from_structured():
    kwargs = {
        "palace_meta": {1: {"title": "A"}},
        "units_by_palace": {1: _palace_units(1, ("a", "b", "c", "d", "e", "f"))},
        "due_by_palace": {1: {"a", "b", "c", "d", "e", "f"}},
        "quizzes": [],
    }

    def _ids(unit_order: str, seed: int) -> list[str]:
        result = assemble_queue(
            config=sanitize_feed_config(
                {
                    "training_mode": "memory_palace",
                    "streams": {
                        "memory_palace": {
                            "palace_order": "finish_palace_then_next",
                            "unit_order": unit_order,
                            "due_policy": "due_only",
                        }
                    },
                    "queue_length": 20,
                    "seed": seed,
                }
            ),
            **kwargs,
        )
        return [card["id"] for card in result.cards]

    structured = _ids("structured", 17)
    random_a = _ids("random", 17)
    random_b = _ids("random", 17)
    random_other = _ids("random", 23)
    assert random_a == random_b
    assert set(random_a) == set(structured)
    assert random_a != random_other


def test_sanitize_defaults_bound_quiz_into_mix_and_mastery_buckets():
    config = sanitize_feed_config({})
    assert config["bound_quiz_placement"] == "into_mix"
    assert config["quiz_mastery_buckets"] == ["unseen", "weak", "reinforce"]
    assert config["quiz_scope"] == "cross_palace_random"


def test_sanitize_repairs_conflicting_quiz_only_toggles():
    config = sanitize_feed_config(
        {
            "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
            "mix_mode": "quiz_only",
        }
    )
    assert config["content"] == {
        "mindmap_branch": False,
        "anki_card": False,
        "quiz_question": True,
    }


def test_sanitize_repairs_mindmap_only_toggles():
    config = sanitize_feed_config(
        {
            "content": {"mindmap_branch": False, "anki_card": False, "quiz_question": True},
            "mix_mode": "mindmap_only",
        }
    )
    assert config["content"]["mindmap_branch"] is True
    assert config["content"]["quiz_question"] is False


def test_context_path_includes_the_marked_node():
    nodes = {
        "root": {"uid": "root", "parent_uid": None, "text": "古希腊的教育阶段"},
        "mark": {"uid": "mark", "parent_uid": "root", "text": "古典时期"},
    }
    assert context_path_including_anchor(nodes, "mark") == (
        {"uid": "root", "text": "古希腊的教育阶段"},
        {"uid": "mark", "text": "古典时期"},
    )
    assert context_path_including_anchor(nodes, "missing") == ()


def _due_unit(
    anchor: str,
    *,
    due: date,
    passed_at: datetime | None,
    palace_id: int = 1,
    topology_order: int = 0,
) -> ReviewUnitCandidate:
    return ReviewUnitCandidate(
        palace_id=palace_id,
        anchor_uid=anchor,
        context_path=(),
        node_uids=(anchor,),
        unit_id=anchor,
        revision=1,
        due_date=due,
        last_passed_at=passed_at,
        has_passed=passed_at is not None,
        topology_order=topology_order,
    )


def _map_config(**extra) -> dict:
    return {
        "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
        "mix_mode": "mindmap_only",
        **extra,
    }


def _unit_order(result) -> list[str]:
    return [card["unit_id"] for card in result.cards]


def test_structured_order_follows_the_topology_not_the_due_date():
    a = _due_unit("A", due=date(2026, 10, 1), passed_at=datetime(2026, 9, 2), topology_order=0)
    b = _due_unit("B", due=date(2026, 9, 20), passed_at=datetime(2026, 9, 2), topology_order=1)
    c = _due_unit("C", due=date(2026, 10, 1), passed_at=datetime(2026, 9, 2), topology_order=2)

    result = _assemble(units=[a, b, c], due_uids={"A", "B", "C"}, config=_map_config())

    # An overdue unit does not jump ahead of the map order.
    assert _unit_order(result) == ["A", "B", "C"]


def _placement_units() -> list[ReviewUnitCandidate]:
    # Topology order R1, R2, N1, R3, N2, R4 (N = never passed, R = reviewed).
    specs = [
        ("R1", True),
        ("R2", True),
        ("N1", False),
        ("R3", True),
        ("N2", False),
        ("R4", True),
    ]
    return [
        _due_unit(
            anchor,
            due=date(2026, 9, 1),
            passed_at=datetime(2026, 9, 2) if passed else None,
            topology_order=index,
        )
        for index, (anchor, passed) in enumerate(specs)
    ]


def _placement_order(**extra) -> list[str]:
    units = _placement_units()
    result = _assemble(
        units=units,
        due_uids={unit.anchor_uid for unit in units},
        config=_map_config(**extra),
    )
    return _unit_order(result)


def test_new_placement_new_first_is_the_default_map_order():
    assert _placement_order(new_placement="new_first") == ["N1", "N2", "R1", "R2", "R3", "R4"]
    assert _placement_order() == ["N1", "N2", "R1", "R2", "R3", "R4"]


def test_quiz_order_new_first_moves_unseen_questions_ahead_and_keeps_group_order():
    from memory_anki.modules.practice.domain.queue_builder import order_quiz_side_by_new_first

    side = [
        {"id": "q1", "mastery_label": "weak"},
        {"id": "q2", "mastery_label": "unseen"},
        {"id": "q3", "mastery_label": ""},
        {"id": "q4", "mastery_label": "stable"},
    ]
    assert [c["id"] for c in order_quiz_side_by_new_first(side, "new_first")] == ["q2", "q3", "q1", "q4"]
    assert [c["id"] for c in order_quiz_side_by_new_first(side, "random")] == ["q1", "q2", "q3", "q4"]


def test_arrange_ratio_appends_leftover_new_after_reviews_run_out():
    cards = [
        {"id": "r1", "is_new": False},
        {"id": "n1", "is_new": True},
        {"id": "n2", "is_new": True},
        {"id": "n3", "is_new": True},
    ]

    arranged = arrange_new_and_review(cards, "ratio", 2)

    # One review, then news while reviews last, then the new leftovers in order.
    assert [card["id"] for card in arranged] == ["r1", "n1", "n2", "n3"]


def test_arrange_ratio_four_keeps_order_inside_each_stream():
    reviews = [{"id": f"r{i}", "is_new": False} for i in range(1, 6)]
    news = [{"id": f"n{i}", "is_new": True} for i in range(1, 3)]

    arranged = arrange_new_and_review([*reviews, *news], "ratio", 4)

    assert [card["id"] for card in arranged] == ["r1", "r2", "r3", "r4", "n1", "r5", "n2"]


def test_bound_quiz_still_follows_its_anchor_when_new_cards_move_forward():
    review = _due_unit("b", due=date(2026, 9, 1), passed_at=datetime(2026, 9, 2))
    new = _due_unit("a", due=date(2026, 9, 1), passed_at=None)
    quizzes = [
        QuizCandidate(21, 1, ("a",), 0.1, "weak", {"id": 21, "palace_id": 1}),
        QuizCandidate(22, 1, ("b",), 0.1, "weak", {"id": 22, "palace_id": 1}),
    ]

    result = _assemble(
        units=[review, new],
        due_uids={"a", "b"},
        quizzes=quizzes,
        config={
            "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": True},
            "mix_mode": "sequential_map_quiz",
            "bound_quiz_placement": "follow_unit",
            "new_placement": "new_first",
            "due_policy": "due_only",
            "queue_length": 20,
        },
    )

    assert [card["id"] for card in result.cards] == [
        "review_unit:a:r1",
        "quiz_question:21",
        "review_unit:b:r1",
        "quiz_question:22",
    ]


def test_phase_stats_count_new_and_review_due_map_units():
    units = _placement_units()
    result = _assemble(
        units=units,
        due_uids={unit.anchor_uid for unit in units},
        config=_map_config(),
    )

    assert result.phase_stats["new_unit_count"] == 2
    assert result.phase_stats["review_unit_count"] == 4


def test_sanitize_new_config_keys_default_and_fall_back_on_invalid_values():
    defaults = sanitize_feed_config({})
    assert defaults["new_placement"] == "new_first"
    assert defaults["review_new_ratio"] == 4

    invalid = sanitize_feed_config(
        {"new_placement": "sideways", "review_new_ratio": 3}
    )
    assert invalid["new_placement"] == "new_first"
    assert invalid["review_new_ratio"] == 4

    boolean_ratio = sanitize_feed_config({"review_new_ratio": True})
    assert boolean_ratio["review_new_ratio"] == 4

    valid = sanitize_feed_config(
        {"new_placement": "ratio", "review_new_ratio": "2"}
    )
    assert valid["new_placement"] == "new_first"
    assert valid["review_new_ratio"] == 2


def test_order_keys_are_pinned_so_stored_values_cannot_change_the_queue():
    config = sanitize_feed_config({"new_placement": "review_first"})
    assert config["new_placement"] == "new_first"
    assert queue_construction_signature({}) == queue_construction_signature(
        {"new_placement": "review_first"}
    )


def test_quiz_order_is_part_of_the_queue_signature():
    assert queue_construction_signature({}) != queue_construction_signature(
        {"streams": {"quiz": {"order": "random"}}}
    )
    assert sanitize_feed_config({"streams": {"quiz": {"order": "bogus"}}})["streams"]["quiz"]["order"] == "new_first"
