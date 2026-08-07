"""Pure tests for the freestyle queue's review-unit projection boundary."""

from __future__ import annotations

from memory_anki.modules.practice.domain.feed_config import sanitize_feed_config
from memory_anki.modules.practice.domain.queue_builder import (
    QuizCandidate,
    assemble_queue,
    merge_content_streams,
)
from memory_anki.modules.practice.domain.review_units import ReviewUnitCandidate


def _unit(
    anchor_uid: str,
    node_uids: tuple[str, ...],
    *,
    palace_id: int = 1,
    unit_id: str | None = None,
    revision: int = 1,
) -> ReviewUnitCandidate:
    return ReviewUnitCandidate(
        palace_id=palace_id,
        anchor_uid=anchor_uid,
        context_path=(),
        node_uids=node_uids,
        unit_id=unit_id or f"unit-{anchor_uid}",
        revision=revision,
    )


def _assemble(
    *,
    units: list[ReviewUnitCandidate],
    due_uids: set[str],
    quizzes: list[QuizCandidate] | None = None,
    config: dict | None = None,
    nodes: dict | None = None,
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
        mastery_by_palace={1: 0.0},
        recent_practice_rank={},
        quizzes=quizzes or [],
        nodes_by_palace={1: nodes or {}},
        completed_ids=completed_ids or [],
    )


def test_queue_emits_only_due_review_units_with_stable_identity():
    due = _unit("a", ("a", "a1"), unit_id="review-a", revision=4)
    future = _unit("b", ("b", "b1"), unit_id="review-b", revision=2)

    result = _assemble(units=[due, future], due_uids={"a", "a1"})

    assert [card["id"] for card in result.cards] == ["review_unit:review-a:r4"]
    assert result.cards[0]["unit_id"] == "review-a"
    assert result.cards[0]["unit_revision"] == 4
    assert result.cards[0]["node_uids"] == ["a", "a1"]
    assert "due_node_uids" not in result.cards[0]


def test_queue_reports_candidate_and_scheduled_counts_when_limit_truncates():
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
    assert len(result.cards) == 5
    assert result.phase_stats["candidate_count"] == 6
    assert result.phase_stats["scheduled_count"] == 5
    assert result.phase_stats["queue_limit"] == 5
    assert result.phase_stats["limit_reached"] is True
    assert "ratable_node_uids" not in result.cards[0]


def test_anki_cards_are_not_emitted_by_the_new_freestyle_queue():
    unit = _unit("front", ("front", "back"), unit_id="review-1", revision=4)
    result = _assemble(
        units=[unit],
        due_uids={"front", "back"},
        config={
            "content": {
                "mindmap_branch": True,
                "anki_card": True,
                "quiz_question": False,
            },
            "mix_mode": "mindmap_only",
            "due_policy": "due_only",
            "queue_length": 20,
        },
        nodes={
            "front": {
                "uid": "front",
                "parent_uid": "root",
                "children": ["back"],
                "anki_role": "front",
            },
            "back": {
                "uid": "back",
                "parent_uid": "front",
                "children": [],
            },
        },
    )

    assert [card["type"] for card in result.cards] == ["mindmap_branch"]
    assert result.cards[0]["id"] == "review_unit:review-1:r4"
    assert result.cards[0]["unit_id"] == "review-1"


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
    assert sanitize_feed_config({
        "subject_scope": "english",
        "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
    })["training_mode"] == "english"
    migrated = sanitize_feed_config({
        "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": True},
    })
    assert migrated["training_mode"] == "mixed"
    assert migrated["mixed_modes"] == ["memory_palace", "quiz"]
    assert migrated["content"]["anki_card"] is False


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


def test_new_revision_is_not_hidden_by_completed_old_revision():
    unit = _unit("a", ("a",), unit_id="review-a", revision=8)
    result = _assemble(
        units=[unit],
        due_uids={"a"},
        completed_ids=["review_unit:review-a:r7"],
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
    assert types.count("quiz_question") == 4
    # While both streams still have items, ratio should interleave ~2 maps then 1 quiz.
    prefix = types[:6]
    assert prefix.count("mindmap_branch") == 4
    assert prefix.count("quiz_question") == 2


def test_quiz_mastery_buckets_exclude_stable_by_default():
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
    assert "quiz_question:1" not in ids
    assert "quiz_question:2" in ids
    assert "quiz_question:3" in ids


def test_quiz_mastery_buckets_can_include_only_unseen():
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
    assert [card["id"] for card in result.cards] == ["quiz_question:2"]


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
        mastery_by_palace={1: 0.0, 2: 0.0},
        recent_practice_rank={},
        quizzes=quizzes,
        nodes_by_palace={1: {}, 2: {}},
    )
    ids = [card["id"] for card in result.cards]
    # All palace-1 quizzes appear contiguously before palace-2 (order within palace may shuffle).
    first_block = ids[:2]
    second_block = ids[2:]
    assert set(first_block) == {"quiz_question:11", "quiz_question:12"}
    assert set(second_block) == {"quiz_question:21", "quiz_question:22"}


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
