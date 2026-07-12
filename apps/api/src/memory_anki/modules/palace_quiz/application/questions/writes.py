"""Question write helpers and persistence commands."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import PalaceQuizQuestion

from ..question_contracts import PalaceQuizValidationError, json_dump
from .serialization import serialize_question


def apply_normalized_question_to_row(
    row: PalaceQuizQuestion,
    normalized: dict[str, object],
) -> PalaceQuizQuestion:
    row.mini_palace_id = _optional_int(normalized.get("mini_palace_id"))
    row.source_chapter_id = _optional_int(normalized.get("source_chapter_id"))
    row.classified_chapter_id = _optional_int(normalized.get("classified_chapter_id"))
    row.origin_question_id = _optional_int(normalized.get("origin_question_id"))
    row.question_type = str(normalized.get("question_type") or "")
    row.stem = str(normalized.get("stem") or "")
    row.options_json = json_dump(normalized["options"], default=[])
    row.answer_payload_json = json_dump(normalized["answer_payload"], default={})
    row.analysis = str(normalized.get("analysis") or "")
    row.source_meta_json = json_dump(normalized["source_meta"], default={})
    return row


def _optional_int(value: object) -> int | None:
    return int(value) if isinstance(value, int) and value > 0 else None


def copy_question_content(
    source: PalaceQuizQuestion,
    target: PalaceQuizQuestion,
) -> PalaceQuizQuestion:
    target.question_type = source.question_type
    target.stem = source.stem
    target.options_json = source.options_json
    target.answer_payload_json = source.answer_payload_json
    target.analysis = source.analysis
    target.source_meta_json = source.source_meta_json
    return target


def merge_question_attempt_counters(
    target: PalaceQuizQuestion,
    source: PalaceQuizQuestion,
) -> PalaceQuizQuestion:
    target.correct_count += source.correct_count
    target.incorrect_count += source.incorrect_count
    target.attempt_count += source.attempt_count
    target.updated_at = utc_now_naive()
    return target


def build_normalized_question_row(
    *,
    normalized: dict[str, Any],
    palace_id: int | None,
    source_chapter_id: int | None,
    sort_order: int,
) -> PalaceQuizQuestion:
    return apply_normalized_question_to_row(
        PalaceQuizQuestion(
            palace_id=palace_id,
            source_chapter_id=source_chapter_id,
            sort_order=sort_order,
        ),
        normalized,
    )


def apply_updated_question_row(
    *,
    row: PalaceQuizQuestion,
    normalized: dict[str, Any],
) -> PalaceQuizQuestion:
    apply_normalized_question_to_row(row, normalized)
    row.updated_at = utc_now_naive()
    return row


def upsert_classified_question_copy_row(
    session: Session,
    *,
    row: PalaceQuizQuestion,
    source_question: PalaceQuizQuestion,
) -> PalaceQuizQuestion:
    copy_question_content(source_question, row)
    row.updated_at = utc_now_naive()
    session.flush()
    return row


def commit_new_question(
    session: Session,
    row: PalaceQuizQuestion,
    *,
    commit: bool = True,
) -> dict[str, object]:
    session.add(row)
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
    return serialize_question(row)


def commit_new_questions(
    session: Session,
    rows: list[PalaceQuizQuestion],
    *,
    commit: bool = True,
) -> list[dict[str, object]]:
    if commit:
        session.commit()
        for row in rows:
            session.refresh(row)
    else:
        session.flush()
    return [serialize_question(row) for row in rows]


def commit_updated_question(
    session: Session,
    *,
    row: PalaceQuizQuestion,
    normalized: dict[str, object],
) -> dict[str, object]:
    apply_updated_question_row(row=row, normalized=normalized)
    session.commit()
    session.refresh(row)
    return serialize_question(row)


def commit_deleted_questions(
    session: Session,
    rows: list[PalaceQuizQuestion],
) -> int:
    now = utc_now_naive()
    for row in rows:
        row.deleted_at = now
        row.updated_at = now
    session.commit()
    return len(rows)


def commit_restored_question(
    session: Session,
    row: PalaceQuizQuestion,
) -> dict[str, object]:
    row.deleted_at = None
    row.updated_at = utc_now_naive()
    session.commit()
    session.refresh(row)
    return serialize_question(row)


def commit_recorded_choice_attempt(
    session: Session,
    *,
    row: PalaceQuizQuestion,
    selected_option_id: str,
    is_correct: bool,
    commit: bool = True,
) -> dict[str, object]:
    row.updated_at = utc_now_naive()
    if commit:
        session.commit()
        session.refresh(row)
    else:
        session.flush()
    return {
        "question": serialize_question(row),
        "selected_option_id": selected_option_id,
        "is_correct": is_correct,
    }


def replace_question_with_duplicate(
    session: Session,
    *,
    kept_row: PalaceQuizQuestion,
    removed_row: PalaceQuizQuestion,
) -> dict[str, object]:
    merge_question_attempt_counters(kept_row, removed_row)
    now = utc_now_naive()
    removed_row.deleted_at = now
    removed_row.updated_at = now
    session.commit()
    session.refresh(kept_row)
    return serialize_question(kept_row)


def _build_existing_question_keys(
    existing_questions: list[PalaceQuizQuestion],
) -> set[str]:
    from .dedup import build_question_dedup_key, question_to_dedup_payload

    return {
        build_question_dedup_key(question_to_dedup_payload(question))
        for question in existing_questions
    }


def batch_create_questions_for_scope(
    session: Session,
    *,
    payloads: list[dict[str, object]],
    existing_questions: list[PalaceQuizQuestion],
    excluded_import_question_ids: set[int] | None = None,
    next_sort_order: int,
    normalize_payload: Callable[[dict[str, object]], dict[str, object]],
    create_row: Callable[[dict[str, object], int], PalaceQuizQuestion],
    commit: bool = True,
) -> list[dict[str, object]]:
    from .dedup import (
        build_existing_import_dedup_keys,
        build_import_dedup_key,
        build_question_dedup_key,
    )

    if not isinstance(payloads, list) or len(payloads) == 0:
        raise PalaceQuizValidationError("批量保存时至少需要一题。")
    existing_keys = _build_existing_question_keys(existing_questions)
    existing_import_keys = build_existing_import_dedup_keys(
        session,
        exclude_question_ids=excluded_import_question_ids,
    )
    payload_keys: set[str] = set()
    payload_import_keys: set[str] = set()
    rows: list[PalaceQuizQuestion] = []
    current_sort_order = next_sort_order
    for payload in payloads:
        normalized = normalize_payload(payload)
        dedup_key = build_question_dedup_key(normalized)
        import_dedup_key = build_import_dedup_key(normalized)
        if (
            dedup_key in existing_keys
            or dedup_key in payload_keys
            or import_dedup_key in existing_import_keys
            or import_dedup_key in payload_import_keys
        ):
            continue
        payload_keys.add(dedup_key)
        payload_import_keys.add(import_dedup_key)
        current_sort_order += 1
        row = create_row(normalized, current_sort_order)
        session.add(row)
        rows.append(row)
    return commit_new_questions(session, rows, commit=commit)


__all__ = [
    "apply_normalized_question_to_row",
    "apply_updated_question_row",
    "batch_create_questions_for_scope",
    "build_normalized_question_row",
    "commit_deleted_questions",
    "commit_new_question",
    "commit_new_questions",
    "commit_recorded_choice_attempt",
    "commit_restored_question",
    "commit_updated_question",
    "copy_question_content",
    "merge_question_attempt_counters",
    "replace_question_with_duplicate",
    "upsert_classified_question_copy_row",
]
