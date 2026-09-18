"""Build the freestyle toolbar 做题 overlay pool without changing training_mode."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.content.public.queries import (
    list_active_palace_ids_by_subject_ids,
    list_active_palace_ids_by_subject_scope,
)
from memory_anki.modules.quiz.public.queries import (
    OVERLAY_QUESTION_RANGE_DUE,
    list_mastery_profiles_for_palaces,
    list_published_questions_for_palaces,
    normalize_overlay_question_range,
    question_is_due,
)

from ..domain.feed_config import sanitize_feed_config
from ..domain.overlay_quiz import overlay_quiz_scope_signature
from ..domain.queue_builder import QuizCandidate, sort_quiz_candidates
from ..domain.quiz_stream import filter_quizzes_by_mastery_buckets, order_quiz_stream_by_scope
from .quiz_cards import DEFAULT_QUIZ_CARD_LIMIT


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


def _resolve_stream_palace_ids(session: Session, stream: dict[str, Any]) -> list[int]:
    subject_scope = str(stream.get("subject_scope") or "all")
    requested_subject_ids = _positive_ids(stream.get("subject_ids"))
    specific_ids = _positive_ids(stream.get("specific_palace_ids"))
    if requested_subject_ids:
        if specific_ids:
            return specific_ids
        return list_active_palace_ids_by_subject_ids(session, requested_subject_ids)
    subject_palaces = list_active_palace_ids_by_subject_scope(session, subject_scope)
    if subject_scope != "all":
        return list(dict.fromkeys([*subject_palaces, *specific_ids]))
    return specific_ids or list(subject_palaces)


def build_overlay_question_pack(session: Session, config_raw: dict[str, Any] | None) -> dict[str, Any]:
    config = sanitize_feed_config(config_raw or {})
    raw_streams = config.get("streams")
    streams: dict[str, Any] = raw_streams if isinstance(raw_streams, dict) else {}
    raw_quiz = streams.get("quiz")
    quiz_stream: dict[str, Any] = raw_quiz if isinstance(raw_quiz, dict) else {}
    raw_memory = streams.get("memory_palace")
    memory_stream: dict[str, Any] = raw_memory if isinstance(raw_memory, dict) else {}
    palace_ids = _resolve_stream_palace_ids(session, quiz_stream)
    if not palace_ids:
        palace_ids = _resolve_stream_palace_ids(session, memory_stream)
    question_type = str(quiz_stream.get("question_type") or config.get("question_type") or "all")
    overlay_range = normalize_overlay_question_range(
        quiz_stream.get("overlay_question_range", config.get("overlay_question_range")),
    )
    questions = list_published_questions_for_palaces(
        session,
        palace_ids=palace_ids or None,
        question_type=question_type,
    )
    mastery_rows = list_mastery_profiles_for_palaces(session, palace_ids=palace_ids or None)
    mastery_by_question = {
        int(row["question_id"]): row
        for row in mastery_rows
        if row.get("question_id") is not None
    }
    quizzes: list[QuizCandidate] = []
    for question in questions:
        qid = int(question.get("id") or 0)
        palace_id = int(question.get("palace_id") or 0)
        if qid <= 0 or palace_id <= 0:
            continue
        if palace_ids and palace_id not in set(palace_ids):
            continue
        if overlay_range == OVERLAY_QUESTION_RANGE_DUE and not question_is_due(question):
            continue
        mastery = mastery_by_question.get(qid) or {}
        raw_score = mastery.get("score")
        quizzes.append(
            QuizCandidate(
                question_id=qid,
                palace_id=palace_id,
                bound_node_uids=(),
                mastery_score=float(raw_score if raw_score is not None else 0.35),
                mastery_label=str(mastery.get("label") or "unseen"),
                question=question,
            )
        )
    mastery_buckets = quiz_stream.get("mastery_buckets") or config.get("quiz_mastery_buckets")
    scoped = filter_quizzes_by_mastery_buckets(quizzes, mastery_buckets)
    weak_priority = bool(quiz_stream.get("weak_priority", config.get("weak_quiz_priority", True)))
    by_palace: dict[int, list[dict[str, Any]]] = {}
    ordered_palace_ids = palace_ids or sorted({item.palace_id for item in scoped})
    for palace_id in ordered_palace_ids:
        palace_quizzes = [item for item in scoped if item.palace_id == palace_id]
        sorted_quizzes = sort_quiz_candidates(palace_quizzes, weak_priority=weak_priority)
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
    candidate_count = len(ordered)
    limited = ordered[:DEFAULT_QUIZ_CARD_LIMIT]
    question_ids = [int(item["id"]) for item in limited if int(item.get("id") or 0) > 0]
    question_palace_ids = {
        str(int(item["id"])): int(item["palace_id"])
        for item in limited
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
            list(mastery_buckets or []),
            weak_priority,
            overlay_range,
        ),
        "limit_reached": candidate_count > len(question_ids),
        "candidate_count": candidate_count,
        "question_palace_ids": question_palace_ids,
    }
