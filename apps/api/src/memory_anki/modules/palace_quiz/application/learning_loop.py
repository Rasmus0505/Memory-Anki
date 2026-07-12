from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import PalaceQuizQuestion, QuizAttemptEvent
from memory_anki.modules.palace_quiz.application.question_contracts import json_dump, json_load
from memory_anki.modules.palace_quiz.application.question_schema import serialize_question

LIFECYCLE_STATUSES = {"temporary", "candidate", "published", "rejected"}


def record_attempt_event(
    session: Session, payload: dict[str, Any], *, commit: bool = True
) -> dict[str, Any]:
    question_id = _positive_int(payload.get("question_id"))
    question = session.get(PalaceQuizQuestion, question_id) if question_id else None
    confidence = _bounded_int(payload.get("confidence"), 1, 5)
    row = QuizAttemptEvent(
        question_id=question.id if question else question_id,
        palace_id=_positive_int(payload.get("palace_id"))
        or (question.palace_id if question else None),
        chapter_id=_positive_int(payload.get("chapter_id"))
        or ((question.classified_chapter_id or question.source_chapter_id) if question else None),
        scene=str(payload.get("scene") or "quiz")[:40],
        question_version=int(
            question.version_number if question else payload.get("question_version") or 1
        ),
        answer_payload_json=json_dump(payload.get("answer_payload"), default={}),
        is_correct=payload.get("is_correct")
        if isinstance(payload.get("is_correct"), bool)
        else None,
        duration_ms=_non_negative_int(payload.get("duration_ms")),
        hint_count=_non_negative_int(payload.get("hint_count")) or 0,
        retry_count=_non_negative_int(payload.get("retry_count")) or 0,
        confidence=confidence,
        ai_score=_bounded_float(payload.get("ai_score"), 0.0, 1.0),
    )
    session.add(row)
    session.flush()
    if commit:
        session.commit()
    return serialize_attempt_event(row)


def serialize_attempt_event(row: QuizAttemptEvent) -> dict[str, Any]:
    return {
        "id": row.id,
        "question_id": row.question_id,
        "palace_id": row.palace_id,
        "chapter_id": row.chapter_id,
        "scene": row.scene,
        "question_version": row.question_version,
        "answer_payload": json_load(row.answer_payload_json, {}),
        "is_correct": row.is_correct,
        "duration_ms": row.duration_ms,
        "hint_count": row.hint_count,
        "retry_count": row.retry_count,
        "confidence": row.confidence,
        "ai_score": row.ai_score,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def review_question_quality(question: PalaceQuizQuestion) -> dict[str, Any]:
    evidence = json_load(question.evidence_json, [])
    issues: list[str] = []
    if not evidence:
        issues.append("缺少可追溯来源证据")
    if len(question.stem.strip()) < 8:
        issues.append("题干过短，可能缺少有效回忆线索")
    if not question.analysis.strip():
        issues.append("缺少解析")
    answer = json_load(question.answer_payload_json, {})
    if not answer:
        issues.append("缺少结构化答案")
    if question.question_type == "multiple_choice":
        options = json_load(question.options_json, [])
        correct = str(answer.get("correct_option_id") or "")
        option_ids = {str(item.get("id") or "") for item in options if isinstance(item, dict)}
        if len(options) < 3:
            issues.append("选择题有效选项少于三个")
        if correct not in option_ids:
            issues.append("正确选项不在选项列表中")
    score = max(0.0, 1.0 - len(issues) * 0.2)
    return {
        "passed": not issues,
        "score": score,
        "issues": issues,
        "reviewed_at": utc_now_naive().isoformat(),
        "reviewer": "rule_engine_v1",
    }


def review_and_store_question_quality(session: Session, question_id: int) -> dict[str, Any]:
    question = session.get(PalaceQuizQuestion, question_id)
    if question is None or question.deleted_at is not None:
        raise ValueError("题目不存在。")
    review = review_question_quality(question)
    question.quality_score = float(review["score"])
    question.quality_review_json = json_dump(review, default={})
    session.commit()
    return {"review": review, "question": serialize_question(question)}


def list_review_queue(
    session: Session, *, palace_id: int | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    query = session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.deleted_at.is_(None),
        PalaceQuizQuestion.lifecycle_status.in_(("temporary", "candidate")),
    )
    if palace_id:
        query = query.filter(PalaceQuizQuestion.palace_id == palace_id)
    rows = (
        query.order_by(PalaceQuizQuestion.updated_at.asc(), PalaceQuizQuestion.id.asc())
        .limit(max(1, min(limit, 300)))
        .all()
    )
    return [serialize_question(row) for row in rows]


def transition_question(session: Session, question_id: int, status: str) -> dict[str, Any]:
    if status not in LIFECYCLE_STATUSES:
        raise ValueError("不支持的题目生命周期状态。")
    question = session.get(PalaceQuizQuestion, question_id)
    if question is None or question.deleted_at is not None:
        raise ValueError("题目不存在。")
    review = review_question_quality(question)
    if status == "published" and not review["passed"]:
        raise ValueError("题目未通过质量检查，不能发布：" + "；".join(review["issues"]))
    question.lifecycle_status = status
    question.quality_score = float(review["score"])
    question.quality_review_json = json_dump(review, default={})
    question.updated_at = utc_now_naive()
    session.commit()
    return serialize_question(question)


def build_mastery_profile(
    session: Session, *, palace_id: int | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    query = session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.deleted_at.is_(None), PalaceQuizQuestion.lifecycle_status == "published"
    )
    if palace_id:
        query = query.filter(PalaceQuizQuestion.palace_id == palace_id)
    questions = query.limit(max(1, min(limit, 500))).all()
    result: list[dict[str, Any]] = []
    now = utc_now_naive()
    for question in questions:
        events = (
            session.query(QuizAttemptEvent)
            .filter(QuizAttemptEvent.question_id == question.id)
            .order_by(QuizAttemptEvent.created_at.desc())
            .limit(20)
            .all()
        )
        if not events:
            score, label, reason = 0.35, "unseen", "尚无统一作答事件"
        else:
            weighted = 0.0
            weight_total = 0.0
            for index, event in enumerate(events):
                recency_weight = 1.0 / (1.0 + index * 0.15)
                value = 1.0 if event.is_correct else 0.0
                if event.hint_count:
                    value -= min(0.35, event.hint_count * 0.12)
                if event.retry_count:
                    value -= min(0.25, event.retry_count * 0.1)
                if event.confidence is not None:
                    value += (event.confidence - 3) * 0.05
                weighted += max(0.0, min(1.0, value)) * recency_weight
                weight_total += recency_weight
            score = weighted / weight_total if weight_total else 0.0
            latest = events[0]
            if latest.created_at and now - latest.created_at > timedelta(days=14):
                score *= 0.85
            label = "stable" if score >= 0.8 else "reinforce" if score >= 0.5 else "weak"
            reason = "综合正确率、提示、重试、信心和近期性计算"
        result.append(
            {
                "question_id": question.id,
                "palace_id": question.palace_id,
                "score": round(score, 3),
                "label": label,
                "reason": reason,
                "question": serialize_question(question),
            }
        )
    return sorted(result, key=lambda item: (item["score"], item["question_id"]))


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _non_negative_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, number)


def _bounded_int(value: Any, minimum: int, maximum: int) -> int | None:
    number = _non_negative_int(value)
    return None if number is None else max(minimum, min(maximum, number))


def _bounded_float(value: Any, minimum: float, maximum: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(minimum, min(maximum, number))
