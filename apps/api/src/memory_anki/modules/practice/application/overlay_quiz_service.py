"""Build the freestyle toolbar 做题 overlay pool without changing training_mode."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.content.public.queries import (
    list_active_palace_ids_by_subject_ids,
    list_active_palace_ids_by_subject_scope,
)
from memory_anki.modules.quiz.public.queries import list_published_questions_for_palaces

from ..domain.feed_config import sanitize_feed_config
from ..domain.overlay_quiz import (
    order_overlay_questions,
    overlay_question_kind,
    overlay_quiz_scope_signature,
)
from ..domain.queue_builder import QuizCandidate, sort_quiz_candidates


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
    # Completed cards and live retries survive a replan. They are history, not
    # permission to keep drawing questions from a palace removed in the picker.
    raw_memory = streams.get("memory_palace")
    memory_stream = raw_memory if isinstance(raw_memory, dict) else {}
    specific_ids = _positive_ids(memory_stream.get("specific_palace_ids"))
    subject_ids = _positive_ids(memory_stream.get("subject_ids"))
    subject_scope = str(memory_stream.get("subject_scope") or "all")
    allowed_ids: set[int] | None = None
    if subject_ids:
        allowed_ids = set(specific_ids or list_active_palace_ids_by_subject_ids(session, subject_ids))
    elif subject_scope != "all":
        allowed_ids = set(list_active_palace_ids_by_subject_scope(session, subject_scope)) | set(specific_ids)
    elif specific_ids:
        allowed_ids = set(specific_ids)
    if allowed_ids is not None:
        resolved_palace_ids = [item for item in resolved_palace_ids if item in allowed_ids]
    # Overlay membership is independent of the feed's single question_type filter.
    questions = list_published_questions_for_palaces(
        session,
        palace_ids=resolved_palace_ids,
        question_type="all",
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
    kind_counts = {"objective": 0, "subjective": 0}
    cards: list[dict[str, Any]] = []
    ordered_palace_ids = resolved_palace_ids
    for palace_id in ordered_palace_ids:
        palace_quizzes = [item for item in quizzes if item.palace_id == palace_id]
        for item in sort_quiz_candidates(palace_quizzes, weak_priority=False):
            kind = overlay_question_kind(str(item.question.get("question_type") or ""))
            kind_counts[kind] = kind_counts.get(kind, 0) + 1
            cards.append(
                {"id": item.question_id, "palace_id": item.palace_id, "kind": kind}
            )
    selected_kinds = {
        str(kind)
        for kind in (config.get("overlay_question_kinds") or ("objective", "subjective"))
    }
    filtered = [card for card in cards if str(card.get("kind") or "") in selected_kinds]
    quiz_scope = str(quiz_stream.get("quiz_scope") or config.get("quiz_scope") or "cross_palace_random")
    type_order = str(config.get("overlay_type_order") or "interleave")
    nesting = str(config.get("overlay_type_palace_nesting") or "palace_then_type")
    seed = int(config.get("seed") or 0)
    ordered = order_overlay_questions(
        filtered,
        ordered_palace_ids,
        quiz_scope=quiz_scope,
        type_order=type_order,
        nesting=nesting,
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
            overlay_question_kinds=list(selected_kinds),
            overlay_type_order=type_order,
            overlay_type_palace_nesting=nesting,
        ),
        "limit_reached": False,
        "candidate_count": len(question_ids),
        "question_palace_ids": question_palace_ids,
        "kind_counts": kind_counts,
    }
