from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_contracts import PalaceQuizValidationError
from .question_dedup import (
    build_question_dedup_key,
    question_to_dedup_payload,
)
from .question_write_support import commit_new_questions


def _build_existing_question_keys(
    existing_questions: list[PalaceQuizQuestion],
) -> set[str]:
    return {
        build_question_dedup_key(question_to_dedup_payload(question))
        for question in existing_questions
    }


def batch_create_questions_for_scope(
    session: Session,
    *,
    payloads: list[dict[str, object]],
    existing_questions: list[PalaceQuizQuestion],
    next_sort_order: int,
    normalize_payload: Callable[[dict[str, object]], dict[str, object]],
    create_row: Callable[[dict[str, object], int], PalaceQuizQuestion],
) -> list[dict[str, object]]:
    if not isinstance(payloads, list) or len(payloads) == 0:
        raise PalaceQuizValidationError("批量保存时至少需要一题。")
    existing_keys = _build_existing_question_keys(existing_questions)
    payload_keys: set[str] = set()
    rows: list[PalaceQuizQuestion] = []
    current_sort_order = next_sort_order
    for payload in payloads:
        normalized = normalize_payload(payload)
        dedup_key = build_question_dedup_key(normalized)
        if dedup_key in existing_keys or dedup_key in payload_keys:
            continue
        payload_keys.add(dedup_key)
        current_sort_order += 1
        row = create_row(normalized, current_sort_order)
        session.add(row)
        rows.append(row)
    return commit_new_questions(session, rows)


__all__ = [
    "batch_create_questions_for_scope",
]
