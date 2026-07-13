"""Question write command use cases."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion, PalaceSegment
from memory_anki.modules.palace_quiz.application.learning_loop import record_attempt_event

from .dedup import find_duplicate_question
from .dedup_keys import build_question_dedup_key, question_to_dedup_payload
from .queries import (
    get_palace_or_raise,
    get_question_or_raise,
    next_chapter_sort_order,
    next_palace_sort_order,
)
from .serialization import serialize_question
from .validation import (
    QUESTION_TYPE_MULTIPLE_CHOICE,
    PalaceQuizValidationError,
    get_chapter_or_raise,
    json_load,
    normalize_question_payload,
)
from .writes import (
    batch_create_questions_for_scope,
    build_normalized_question_row,
    commit_deleted_questions,
    commit_new_question,
    commit_recorded_choice_attempt,
    commit_restored_question,
    commit_updated_question,
    replace_question_with_duplicate,
)


def _assign_question_segments(
    session: Session,
    row: PalaceQuizQuestion,
    normalized: dict[str, Any],
) -> PalaceQuizQuestion:
    segment_ids = [int(item) for item in normalized.get("segment_ids", [])]
    row.segments = (
        session.query(PalaceSegment).filter(PalaceSegment.id.in_(segment_ids)).all()
        if segment_ids
        else []
    )
    return row


def _build_question_row_with_segments(
    session: Session,
    *,
    normalized: dict[str, Any],
    palace_id: int | None,
    source_chapter_id: int | None,
    sort_order: int,
) -> PalaceQuizQuestion:
    return _assign_question_segments(
        session,
        build_normalized_question_row(
            normalized=normalized,
            palace_id=palace_id,
            source_chapter_id=source_chapter_id,
            sort_order=sort_order,
        ),
        normalized,
    )


def create_question(
    session: Session,
    palace_id: int,
    payload: dict[str, Any],
    *,
    commit: bool = True,
) -> dict[str, Any]:
    get_palace_or_raise(session, palace_id)
    normalized = normalize_question_payload(payload, session=session, palace_id=palace_id)
    duplicate = find_duplicate_question(session, palace_id, None, normalized)
    if duplicate is not None:
        _assign_question_segments(session, duplicate, normalized)
        if commit:
            session.commit()
            session.refresh(duplicate)
        return serialize_question(duplicate)
    row = _build_question_row_with_segments(
        session,
        normalized=normalized,
        palace_id=palace_id,
        source_chapter_id=None,
        sort_order=next_palace_sort_order(session, palace_id) + 1,
    )
    return commit_new_question(session, row, commit=commit)


def batch_create_questions(
    session: Session,
    palace_id: int,
    payloads: list[dict[str, Any]],
    *,
    commit: bool = True,
) -> list[dict[str, Any]]:
    get_palace_or_raise(session, palace_id)
    existing_questions = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.palace_id == palace_id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .all()
    )
    return batch_create_questions_for_scope(
        session,
        payloads=payloads,
        existing_questions=existing_questions,
        next_sort_order=next_palace_sort_order(session, palace_id),
        normalize_payload=lambda payload: normalize_question_payload(
            payload,
            session=session,
            palace_id=palace_id,
        ),
        create_row=lambda normalized, sort_order: _build_question_row_with_segments(
            session,
            normalized=normalized,
            palace_id=palace_id,
            source_chapter_id=None,
            sort_order=sort_order,
        ),
        commit=commit,
    )


def batch_create_chapter_questions(
    session: Session,
    chapter_id: int,
    payloads: list[dict[str, Any]],
    *,
    save_mode: str = "append",
    commit: bool = True,
) -> list[dict[str, Any]]:
    get_chapter_or_raise(session, chapter_id)
    normalized_save_mode = str(save_mode or "append").strip().lower()
    if normalized_save_mode not in {"append", "overwrite"}:
        raise PalaceQuizValidationError("题目保存模式必须是 append 或 overwrite。")
    existing_questions = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.source_chapter_id == chapter_id,
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .all()
    )
    excluded_import_question_ids: set[int] | None = None
    next_sort_order = next_chapter_sort_order(session, chapter_id)
    if normalized_save_mode == "overwrite":
        excluded_import_question_ids = {int(question.id) for question in existing_questions}
        now = utc_now_naive()
        for question in existing_questions:
            question.deleted_at = now
            question.updated_at = now
        existing_questions = []
        next_sort_order = 0
    return batch_create_questions_for_scope(
        session,
        payloads=payloads,
        existing_questions=existing_questions,
        excluded_import_question_ids=excluded_import_question_ids,
        next_sort_order=next_sort_order,
        normalize_payload=lambda payload: normalize_question_payload(
            {
                **payload,
                "source_chapter_id": chapter_id,
            },
            session=session,
            source_chapter_id=chapter_id,
        ),
        create_row=lambda normalized, sort_order: build_normalized_question_row(
            normalized=normalized,
            palace_id=None,
            source_chapter_id=chapter_id,
            sort_order=sort_order,
        ),
        commit=commit,
    )


def _build_update_payload(
    question,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "segment_ids": payload.get("segment_ids", [segment.id for segment in question.segments]),
        "source_chapter_id": payload.get("source_chapter_id", question.source_chapter_id),
        "classified_chapter_id": payload.get(
            "classified_chapter_id", question.classified_chapter_id
        ),
        "origin_question_id": payload.get("origin_question_id", question.origin_question_id),
        "question_type": payload.get("question_type", question.question_type),
        "stem": payload.get("stem", question.stem),
        "options": payload.get("options", json_load(question.options_json, [])),
        "answer_payload": payload.get(
            "answer_payload", json_load(question.answer_payload_json, {})
        ),
        "analysis": payload.get("analysis", question.analysis),
        "source_meta": payload.get("source_meta", json_load(question.source_meta_json, {})),
    }


def update_question(
    session: Session,
    question_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    question = get_question_or_raise(session, question_id)
    normalized = normalize_question_payload(
        _build_update_payload(question, payload),
        session=session,
        palace_id=question.palace_id,
        source_chapter_id=question.source_chapter_id,
    )
    duplicate = find_duplicate_question(
        session,
        question.palace_id,
        question.source_chapter_id,
        normalized,
        exclude_question_id=question.id,
    )
    if duplicate is not None:
        return replace_question_with_duplicate(
            session,
            kept_row=duplicate,
            removed_row=question,
        )
    _assign_question_segments(session, question, normalized)
    return commit_updated_question(
        session,
        row=question,
        normalized=normalized,
    )


def _normalize_batch_delete_ids(question_ids: list[int]) -> list[int]:
    if not isinstance(question_ids, list) or len(question_ids) == 0:
        raise PalaceQuizValidationError("批量删除时至少需要选择一题。")
    normalized_ids: list[int] = []
    seen_ids: set[int] = set()
    for raw_id in question_ids:
        try:
            question_id = int(raw_id)
        except (TypeError, ValueError) as exc:
            raise PalaceQuizValidationError("批量删除的题目 id 不合法。") from exc
        if question_id <= 0 or question_id in seen_ids:
            continue
        seen_ids.add(question_id)
        normalized_ids.append(question_id)
    if len(normalized_ids) == 0:
        raise PalaceQuizValidationError("批量删除时至少需要选择一题。")
    return normalized_ids


def delete_question(session: Session, question_id: int) -> None:
    question = get_question_or_raise(session, question_id)
    commit_deleted_questions(session, [question])


def batch_delete_questions(session: Session, question_ids: list[int]) -> int:
    normalized_ids = _normalize_batch_delete_ids(question_ids)
    rows = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.id.in_(normalized_ids),
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .all()
    )
    return commit_deleted_questions(session, rows)


def restore_question(session: Session, question_id: int) -> dict[str, object]:
    question = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.id == question_id,
            PalaceQuizQuestion.deleted_at.isnot(None),
        )
        .first()
    )
    if question is None:
        raise PalaceQuizValidationError("题目不存在，或未处于删除状态。")
    if question.palace_id is not None:
        active_palace = (
            session.query(Palace.id)
            .filter(
                Palace.id == question.palace_id,
                Palace.deleted_at.is_(None),
            )
            .first()
        )
        if active_palace is None:
            raise PalaceQuizValidationError("题目所属宫殿已删除，无法恢复题目。")
    dedup_key = build_question_dedup_key(question_to_dedup_payload(question))
    duplicate_query = session.query(PalaceQuizQuestion).filter(
        PalaceQuizQuestion.id != question.id,
        PalaceQuizQuestion.deleted_at.is_(None),
    )
    if question.palace_id is not None:
        duplicate_query = duplicate_query.filter(
            PalaceQuizQuestion.palace_id == question.palace_id,
        )
    else:
        duplicate_query = duplicate_query.filter(
            PalaceQuizQuestion.source_chapter_id == question.source_chapter_id,
            PalaceQuizQuestion.classified_chapter_id == question.classified_chapter_id,
        )
    for candidate in duplicate_query.all():
        if build_question_dedup_key(question_to_dedup_payload(candidate)) == dedup_key:
            raise PalaceQuizValidationError("已有相同的活跃题目，无法恢复该题。")
    return commit_restored_question(session, question)


def record_choice_attempt(
    session: Session,
    question_id: int,
    selected_option_id: str,
    *,
    commit: bool = True,
) -> dict[str, object]:
    question = get_question_or_raise(session, question_id)
    if question.question_type != QUESTION_TYPE_MULTIPLE_CHOICE:
        raise PalaceQuizValidationError("只有选择题可以累计对错统计。")
    normalized_selected_option_id = str(selected_option_id or "").strip()
    if not normalized_selected_option_id:
        raise PalaceQuizValidationError("请选择一个选项。")
    answer_payload = json_load(question.answer_payload_json, {})
    correct_option_id = str(answer_payload.get("correct_option_id") or "").strip()
    is_correct = normalized_selected_option_id == correct_option_id
    question.attempt_count += 1
    if is_correct:
        question.correct_count += 1
    else:
        question.incorrect_count += 1
    record_attempt_event(
        session,
        {
            "question_id": question.id,
            "palace_id": question.palace_id,
            "chapter_id": question.classified_chapter_id or question.source_chapter_id,
            "scene": "palace_quiz",
            "answer_payload": {"selected_option_id": normalized_selected_option_id},
            "is_correct": is_correct,
        },
        commit=False,
    )
    return commit_recorded_choice_attempt(
        session,
        row=question,
        selected_option_id=normalized_selected_option_id,
        is_correct=is_correct,
        commit=commit,
    )


def _normalize_attempt_reset_ids(question_ids: list[int]) -> list[int]:
    if not isinstance(question_ids, list) or len(question_ids) == 0:
        raise PalaceQuizValidationError("清空做题进度时至少需要选择一题。")
    normalized_ids: list[int] = []
    seen_ids: set[int] = set()
    for raw_id in question_ids:
        try:
            question_id = int(raw_id)
        except (TypeError, ValueError) as exc:
            raise PalaceQuizValidationError("清空做题进度的题目 id 不合法。") from exc
        if question_id <= 0 or question_id in seen_ids:
            continue
        seen_ids.add(question_id)
        normalized_ids.append(question_id)
    if len(normalized_ids) == 0:
        raise PalaceQuizValidationError("清空做题进度时至少需要选择一题。")
    return normalized_ids


def reset_question_attempts(session: Session, question_ids: list[int]) -> int:
    normalized_ids = _normalize_attempt_reset_ids(question_ids)
    rows = (
        session.query(PalaceQuizQuestion)
        .filter(
            PalaceQuizQuestion.id.in_(normalized_ids),
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .all()
    )
    now = utc_now_naive()
    for row in rows:
        row.attempt_count = 0
        row.correct_count = 0
        row.incorrect_count = 0
        row.updated_at = now
    session.commit()
    return len(rows)


__all__ = [
    "batch_create_chapter_questions",
    "batch_create_questions",
    "batch_delete_questions",
    "create_question",
    "delete_question",
    "record_choice_attempt",
    "reset_question_attempts",
    "restore_question",
    "update_question",
]
