"""打乱题库 for the 做题 overlay. Framework-free and order-only.

The learner's rule: an answered question keeps its slot, and only the questions
still open are shuffled. The new order and ``current_index`` are written into the
round plan, so closing and reopening the window keeps the shuffled order; the
next click bumps ``shuffle_nonce`` for a fresh order.

A fully answered pool has no open slot left to protect, so the whole pool is
shuffled and the cursor returns to the first question. Without that, 打乱题库
would be a no-op exactly when the learner finishes the last question.

Derived from the stored seed and nonce through ``deterministic_shuffle`` rather
than a random source: the order is persisted, so it must be reproducible from
the round state (repo invariant 6).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .overlay_quiz import OverlayQuiz, normalize_overlay_quiz
from .quiz_stream import deterministic_shuffle


def _answered_ids(overlay: Mapping[str, Any]) -> set[int]:
    """Answered = recorded completed, or an answer state already resolved."""
    answered = {int(item) for item in overlay["completed_ids"]}
    for key, state in overlay["states"].items():
        if isinstance(state, Mapping) and state.get("resolved"):
            answered.add(int(key))
    return answered


def shuffle_overlay_question_order(overlay: Mapping[str, Any] | None) -> OverlayQuiz:
    """Shuffle the unanswered questions in place; answered ones keep their slot."""
    current = normalize_overlay_quiz(overlay)
    question_ids = [int(item) for item in current["question_ids"]]
    nonce = int(current["shuffle_nonce"]) + 1
    current["shuffle_nonce"] = nonce
    if len(question_ids) < 2:
        # Nothing to reorder; still remember the click so the next one differs.
        return normalize_overlay_quiz(current)
    seed = int(current["seed"]) * 2_000_003 + nonce
    answered = _answered_ids(current)
    open_slots = [index for index, qid in enumerate(question_ids) if qid not in answered]
    if open_slots:
        open_cards = [{"id": question_ids[index]} for index in open_slots]
        shuffled = deterministic_shuffle(open_cards, seed=seed, salt="overlay-unanswered")
        ordered = list(question_ids)
        for slot, card in zip(open_slots, shuffled, strict=True):
            ordered[slot] = int(card["id"])
    else:
        # Everything is answered: shuffle the pool as a whole and restart at the top.
        cards = [{"id": qid} for qid in question_ids]
        ordered = [
            int(card["id"])
            for card in deterministic_shuffle(cards, seed=seed, salt="overlay-all-answered")
        ]
    current["question_ids"] = ordered
    first_open = next(
        (index for index, qid in enumerate(ordered) if qid not in answered),
        0,
    )
    current["current_index"] = first_open
    return normalize_overlay_quiz(current)


__all__ = ["shuffle_overlay_question_order"]
