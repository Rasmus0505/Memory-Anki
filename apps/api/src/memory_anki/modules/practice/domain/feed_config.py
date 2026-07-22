"""Freestyle immersive feed configuration validation."""

from __future__ import annotations

from typing import Any

DEFAULT_MINDMAP_WEIGHT = 2
DEFAULT_QUIZ_WEIGHT = 1
DEFAULT_NODE_LIMIT = 12
DEFAULT_QUEUE_LENGTH = 20
DEFAULT_SEED = 17

DUE_POLICY_DUE_FIRST = "due_first_then_expand"
DUE_POLICY_DUE_ONLY = "due_only"
DUE_POLICY_ALL_WEIGHTED = "all_content_due_weighted"

PALACE_ORDER_SEQUENTIAL = "finish_palace_then_next"
PALACE_ORDER_INTERLEAVE = "interleave_palaces"

WITHIN_PALACE_TREE = "tree_order"
WITHIN_PALACE_SHUFFLE = "deterministic_shuffle"

DUE_POLICIES = {
    DUE_POLICY_DUE_FIRST,
    DUE_POLICY_DUE_ONLY,
    DUE_POLICY_ALL_WEIGHTED,
}

PALACE_ORDERS = {
    PALACE_ORDER_SEQUENTIAL,
    PALACE_ORDER_INTERLEAVE,
}

WITHIN_PALACE_ORDERS = {
    WITHIN_PALACE_TREE,
    WITHIN_PALACE_SHUFFLE,
}

QUESTION_TYPES = {
    "all",
    "multiple_choice",
    "true_false",
    "fill_blank",
    "matching",
    "ordering",
    "categorization",
    "short_answer",
}


def _as_bool(value: Any, default: bool) -> bool:
    return value if isinstance(value, bool) else default


def _as_int(value: Any, default: int, *, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _as_positive_ids(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    result: list[int] = []
    seen: set[int] = set()
    for item in value:
        try:
            number = int(item)
        except (TypeError, ValueError):
            continue
        if number <= 0 or number in seen:
            continue
        seen.add(number)
        result.append(number)
    return result


def sanitize_feed_config(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    raw_content = data.get("content")
    content: dict[str, Any] = raw_content if isinstance(raw_content, dict) else {}
    raw_weights = data.get("weights")
    weights: dict[str, Any] = raw_weights if isinstance(raw_weights, dict) else {}
    mindmap_enabled = _as_bool(content.get("mindmap_branch"), True)
    quiz_enabled = _as_bool(content.get("quiz_question"), True)
    if not mindmap_enabled and not quiz_enabled:
        mindmap_enabled = True
        quiz_enabled = True

    palace_order = str(data.get("palace_order") or PALACE_ORDER_SEQUENTIAL)
    if palace_order not in PALACE_ORDERS:
        palace_order = PALACE_ORDER_SEQUENTIAL

    within_palace_order = str(data.get("within_palace_order") or WITHIN_PALACE_TREE)
    if within_palace_order not in WITHIN_PALACE_ORDERS:
        within_palace_order = WITHIN_PALACE_TREE

    due_policy = str(data.get("due_policy") or DUE_POLICY_DUE_FIRST)
    if due_policy not in DUE_POLICIES:
        due_policy = DUE_POLICY_DUE_FIRST

    question_type = str(data.get("question_type") or "all")
    if question_type not in QUESTION_TYPES:
        question_type = "all"

    return {
        "content": {
            "mindmap_branch": mindmap_enabled,
            "quiz_question": quiz_enabled,
        },
        "weights": {
            "mindmap_branch": _as_int(
                weights.get("mindmap_branch"),
                DEFAULT_MINDMAP_WEIGHT,
                minimum=0,
                maximum=20,
            ),
            "quiz_question": _as_int(
                weights.get("quiz_question"),
                DEFAULT_QUIZ_WEIGHT,
                minimum=0,
                maximum=20,
            ),
        },
        "palace_order": palace_order,
        "within_palace_order": within_palace_order,
        "due_policy": due_policy,
        "node_limit": _as_int(data.get("node_limit"), DEFAULT_NODE_LIMIT, minimum=3, maximum=50),
        "queue_length": _as_int(
            data.get("queue_length"), DEFAULT_QUEUE_LENGTH, minimum=5, maximum=100
        ),
        "specific_palace_ids": _as_positive_ids(data.get("specific_palace_ids")),
        "question_type": question_type,
        "weak_quiz_priority": _as_bool(data.get("weak_quiz_priority"), True),
        "seed": _as_int(data.get("seed"), DEFAULT_SEED, minimum=1, maximum=2_147_483_647),
    }


__all__ = [
    "DEFAULT_MINDMAP_WEIGHT",
    "DEFAULT_NODE_LIMIT",
    "DEFAULT_QUEUE_LENGTH",
    "DEFAULT_QUIZ_WEIGHT",
    "DEFAULT_SEED",
    "DUE_POLICIES",
    "DUE_POLICY_ALL_WEIGHTED",
    "DUE_POLICY_DUE_FIRST",
    "DUE_POLICY_DUE_ONLY",
    "PALACE_ORDER_INTERLEAVE",
    "PALACE_ORDER_SEQUENTIAL",
    "PALACE_ORDERS",
    "QUESTION_TYPES",
    "WITHIN_PALACE_ORDERS",
    "WITHIN_PALACE_SHUFFLE",
    "WITHIN_PALACE_TREE",
    "sanitize_feed_config",
]
