"""Build the freestyle toolbar 做题 overlay pool without changing training_mode."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.quiz.public.queries import list_published_questions_for_palaces

from ..domain.feed_config import sanitize_feed_config
from ..domain.overlay_quiz import overlay_quiz_scope_signature
from ..domain.queue_builder import QuizCandidate, sort_quiz_candidates
from ..domain.quiz_stream import order_quiz_stream_by_scope


def _positive_ids(value: Any) -> list[int]:
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


def build_overlay_question_pack(
    session: Session,
    config_raw: dict[str, Any] | None,
    *,
    palace_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Questions for toolbar 做题.

    ``palace_ids`` is the round's review set. Subject scope and saved palace
    lists do not add palaces that this round did not schedule.
    """
    config = sanitize_feed_config(config_raw or {})
    raw_streams = config.get("streams")
    streams: dict[str, Any] = raw_streams if isinstance(raw_streams, dict) else {}
    raw_quiz = streams.get("quiz")
    quiz_stream: dict[str, Any] = raw_quiz if isinstance(raw_quiz, dict) else {}
    resolved_palace_ids = _positive_ids(palace_ids)
    question_type = str(quiz_stream.get("question_type") or config.get("question_type") or "all")
    questions = list_published_questions_for_palaces(
        session,
        palace_ids=resolved_palace_ids,
        question_type=question_type,
    )
    quizzes: list[QuizCandidate] = []
    for question in questions:
        qid = int(question.get("id") or 0)
        palace_id = int(question.get("palace_id") or 0)
        if qid <= 0 or palace_id <= 0:
            continue
        if palace_id not in set(resolved_palace_ids):
            continue
        quizzes.append(
            QuizCandidate(
                question_id=qid,
                palace_id=palace_id,
                bound_node_uids=(),
                mastery_score=0.0,
                mastery_label="",
                question=question,
            )
        )
    by_palace: dict[int, list[dict[str, Any]]] = {}
    ordered_palace_ids = resolved_palace_ids
    for palace_id in ordered_palace_ids:
        palace_quizzes = [item for item in quizzes if item.palace_id == palace_id]
        sorted_quizzes = sort_quiz_candidates(palace_quizzes, weak_priority=False)
        by_palace[palace_id] = [
            {"id": item.question_id, "palace_id": item.palace_id} for item in sorted_quizzes
        ]
    quiz_scope = str(quiz_stream.get("quiz_scope") or config.get("quiz_scope") or "cross_palace_random")
    seed = int(config.get("seed") or 0)
    ordered = order_quiz_stream_by_scope(
        by_palace,
        ordered_palace_ids,
        quiz_scope=quiz_scope,
        seed=seed,
    )
    question_ids = [int(item["id"]) for item in ordered if int(item.get("id") or 0) > 0]
    question_palace_ids = {
        str(int(item["id"])): int(item["palace_id"])
        for item in ordered
        if int(item.get("id") or 0) > 0 and int(item.get("palace_id") or 0) > 0
    }
    return {
        "question_ids": question_ids,
        "quiz_scope": quiz_scope,
        "seed": seed,
        "scope_signature": overlay_quiz_scope_signature(
            ordered_palace_ids,
            quiz_scope,
            question_type,
        ),
        "limit_reached": False,
        "candidate_count": len(question_ids),
        "question_palace_ids": question_palace_ids,
    }
