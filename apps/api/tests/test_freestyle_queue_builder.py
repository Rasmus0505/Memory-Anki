"""Pure tests for the freestyle queue's review-unit projection boundary."""

from __future__ import annotations

from memory_anki.modules.practice.domain.feed_config import sanitize_feed_config
from memory_anki.modules.practice.domain.queue_builder import (
    QuizCandidate,
    assemble_queue,
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
        palace_meta={1: {"title": "测试宫殿"}},
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
    assert "ratable_node_uids" not in result.cards[0]


def test_anki_card_supplements_unit_without_rating_identity():
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

    assert [card["type"] for card in result.cards] == [
        "mindmap_branch",
        "anki_card",
    ]
    unit_card, anki_card = result.cards
    assert unit_card["id"] == "review_unit:review-1:r4"
    assert unit_card["unit_id"] == "review-1"
    assert "unit_id" not in anki_card
    assert "unit_revision" not in anki_card


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
