from __future__ import annotations

import json
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import (
    ExternalAiCallLog,
    FreestyleAiExplanation,
    FreestyleQuizAttempt,
    PalaceQuizQuestion,
)

FREESTYLE_HISTORY_MODES = {"today", "free"}
AI_EXPLANATION_OPERATIONS = {
    "palace_quiz_question_explain",
    "palace_quiz_short_answer_feedback",
}


def _json_dump(value: Any) -> str:
    try:
        return json.dumps(value if value is not None else {}, ensure_ascii=False)
    except (TypeError, ValueError):
        return "{}"


def _json_load(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value or "")
    except (TypeError, ValueError):
        return fallback


def _int_or_none(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _text(value: Any, limit: int | None = None) -> str:
    result = str(value or "").strip()
    if limit and len(result) > limit:
        return result[:limit]
    return result


def _normalize_limit(value: int | None) -> int:
    try:
        limit = int(value or 50)
    except (TypeError, ValueError):
        limit = 50
    return max(1, min(limit, 200))


def _normalize_mode(value: Any) -> str:
    mode = str(value or "free").strip()
    if mode not in FREESTYLE_HISTORY_MODES:
        raise ValueError("随心模式历史记录 mode 必须是 today 或 free。")
    return mode


def _question_fallback(session: Session, question_id: int | None) -> PalaceQuizQuestion | None:
    if not question_id:
        return None
    return session.query(PalaceQuizQuestion).filter_by(id=question_id).first()


def _attempt_row_payload(row: FreestyleQuizAttempt) -> dict[str, Any]:
    return {
        "id": row.id,
        "question_id": row.question_id,
        "palace_id": row.palace_id,
        "palace_title": row.palace_title,
        "mini_palace_id": row.mini_palace_id,
        "mini_palace_name": row.mini_palace_name,
        "chapter_id": row.chapter_id,
        "chapter_name": row.chapter_name,
        "mode": row.mode,
        "question_type": row.question_type,
        "stem_snapshot": row.stem_snapshot,
        "answer_payload": _json_load(row.answer_payload_json, {}),
        "is_correct": row.is_correct,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _explanation_row_payload(row: FreestyleAiExplanation) -> dict[str, Any]:
    return {
        "id": row.id,
        "question_id": row.question_id,
        "palace_id": row.palace_id,
        "palace_title": row.palace_title,
        "mini_palace_id": row.mini_palace_id,
        "mini_palace_name": row.mini_palace_name,
        "chapter_id": row.chapter_id,
        "chapter_name": row.chapter_name,
        "question_type": row.question_type,
        "stem_snapshot": row.stem_snapshot,
        "user_question": row.user_question,
        "explanation_text": row.explanation_text,
        "ai_call_log_id": row.ai_call_log_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def create_question_attempt(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("随心做题记录 payload 无效。")
    question_id = _int_or_none(payload.get("question_id"))
    if not question_id:
        raise ValueError("随心做题记录需要题目 id。")
    question = _question_fallback(session, question_id)
    is_correct = payload.get("is_correct")
    row = FreestyleQuizAttempt(
        question_id=question_id,
        palace_id=_int_or_none(payload.get("palace_id")) or getattr(question, "palace_id", None),
        palace_title=_text(payload.get("palace_title"), 200),
        mini_palace_id=_int_or_none(payload.get("mini_palace_id")) or getattr(question, "mini_palace_id", None),
        mini_palace_name=_text(payload.get("mini_palace_name"), 200),
        chapter_id=_int_or_none(payload.get("chapter_id"))
        or getattr(question, "classified_chapter_id", None)
        or getattr(question, "source_chapter_id", None),
        chapter_name=_text(payload.get("chapter_name"), 200),
        mode=_normalize_mode(payload.get("mode")),
        question_type=_text(payload.get("question_type") or getattr(question, "question_type", ""), 32),
        stem_snapshot=_text(payload.get("stem_snapshot") or getattr(question, "stem", "")),
        answer_payload_json=_json_dump(payload.get("answer_payload")),
        is_correct=is_correct if isinstance(is_correct, bool) else None,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _attempt_row_payload(row)


def list_question_attempts(
    session: Session,
    *,
    limit: int | None = 50,
    palace_id: int | None = None,
    question_id: int | None = None,
    mode: str | None = None,
) -> list[dict[str, Any]]:
    query = session.query(FreestyleQuizAttempt)
    if palace_id is not None:
        query = query.filter(FreestyleQuizAttempt.palace_id == palace_id)
    if question_id is not None:
        query = query.filter(FreestyleQuizAttempt.question_id == question_id)
    if mode:
        query = query.filter(FreestyleQuizAttempt.mode == _normalize_mode(mode))
    rows = (
        query.order_by(FreestyleQuizAttempt.created_at.desc(), FreestyleQuizAttempt.id.desc())
        .limit(_normalize_limit(limit))
        .all()
    )
    return [_attempt_row_payload(row) for row in rows]


def create_question_explanation(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("随心 AI 讲解记录 payload 无效。")
    question_id = _int_or_none(payload.get("question_id"))
    if not question_id:
        raise ValueError("随心 AI 讲解历史需要题目 id。")
    question = _question_fallback(session, question_id)
    explanation_text = _text(payload.get("explanation_text"))
    user_question = _text(payload.get("user_question"))
    if not user_question:
        raise ValueError("AI 讲解历史需要用户问题。")
    if not explanation_text:
        raise ValueError("AI 讲解历史需要讲解内容。")
    row = FreestyleAiExplanation(
        question_id=question_id,
        palace_id=_int_or_none(payload.get("palace_id")) or getattr(question, "palace_id", None),
        palace_title=_text(payload.get("palace_title"), 200),
        mini_palace_id=_int_or_none(payload.get("mini_palace_id")) or getattr(question, "mini_palace_id", None),
        mini_palace_name=_text(payload.get("mini_palace_name"), 200),
        chapter_id=_int_or_none(payload.get("chapter_id"))
        or getattr(question, "classified_chapter_id", None)
        or getattr(question, "source_chapter_id", None),
        chapter_name=_text(payload.get("chapter_name"), 200),
        question_type=_text(payload.get("question_type") or getattr(question, "question_type", ""), 32),
        stem_snapshot=_text(payload.get("stem_snapshot") or getattr(question, "stem", "")),
        user_question=user_question,
        explanation_text=explanation_text,
        ai_call_log_id=_text(payload.get("ai_call_log_id"), 64) or None,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return _explanation_row_payload(row)


def list_question_explanations(
    session: Session,
    *,
    limit: int | None = 50,
    palace_id: int | None = None,
    question_id: int | None = None,
) -> list[dict[str, Any]]:
    query = session.query(FreestyleAiExplanation)
    if palace_id is not None:
        query = query.filter(FreestyleAiExplanation.palace_id == palace_id)
    if question_id is not None:
        query = query.filter(FreestyleAiExplanation.question_id == question_id)
    rows = (
        query.order_by(FreestyleAiExplanation.created_at.desc(), FreestyleAiExplanation.id.desc())
        .limit(_normalize_limit(limit))
        .all()
    )
    return [_explanation_row_payload(row) for row in rows]


def build_history_summary(session: Session) -> dict[str, Any]:
    legacy = session.query(
        func.count(PalaceQuizQuestion.id),
        func.coalesce(func.sum(PalaceQuizQuestion.attempt_count), 0),
        func.coalesce(func.sum(PalaceQuizQuestion.correct_count), 0),
        func.coalesce(func.sum(PalaceQuizQuestion.incorrect_count), 0),
        func.coalesce(
            func.sum(case((PalaceQuizQuestion.attempt_count > 0, 1), else_=0)),
            0,
        ),
    ).one()
    stored_attempt_count = session.query(func.count(FreestyleQuizAttempt.id)).scalar() or 0
    stored_explanation_count = session.query(func.count(FreestyleAiExplanation.id)).scalar() or 0
    ai_log_counts = dict(
        session.query(ExternalAiCallLog.operation, func.count(ExternalAiCallLog.id))
        .filter(ExternalAiCallLog.operation.in_(AI_EXPLANATION_OPERATIONS))
        .group_by(ExternalAiCallLog.operation)
        .all()
    )
    explain_count = int(ai_log_counts.get("palace_quiz_question_explain", 0))
    feedback_count = int(ai_log_counts.get("palace_quiz_short_answer_feedback", 0))
    return {
        "stored": {
            "attempt_count": int(stored_attempt_count),
            "explanation_count": int(stored_explanation_count),
        },
        "legacy_quiz": {
            "question_count": int(legacy[0] or 0),
            "attempted_question_count": int(legacy[4] or 0),
            "attempt_count": int(legacy[1] or 0),
            "correct_count": int(legacy[2] or 0),
            "incorrect_count": int(legacy[3] or 0),
        },
        "legacy_ai_logs": {
            "total_count": explain_count + feedback_count,
            "explanation_count": explain_count,
            "short_answer_feedback_count": feedback_count,
        },
    }


__all__ = [
    "build_history_summary",
    "create_question_attempt",
    "create_question_explanation",
    "list_question_attempts",
    "list_question_explanations",
]
