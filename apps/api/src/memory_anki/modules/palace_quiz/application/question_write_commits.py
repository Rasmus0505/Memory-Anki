"""Persistence and commit helpers for palace quiz question writes."""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_record_support import merge_question_attempt_counters
from .question_serialization import serialize_question
from .question_write_rows import apply_updated_question_row


def commit_new_question(
    session: Session,
    row: PalaceQuizQuestion,
) -> dict[str, object]:
    session.add(row)
    session.commit()
    session.refresh(row)
    return serialize_question(row)


def commit_new_questions(
    session: Session,
    rows: list[PalaceQuizQuestion],
) -> list[dict[str, object]]:
    session.commit()
    for row in rows:
        session.refresh(row)
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
    for row in rows:
        session.delete(row)
    session.commit()
    return len(rows)


def commit_recorded_choice_attempt(
    session: Session,
    *,
    row: PalaceQuizQuestion,
    selected_option_id: str,
    is_correct: bool,
) -> dict[str, object]:
    row.updated_at = utc_now_naive()
    session.commit()
    session.refresh(row)
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
    session.delete(removed_row)
    session.commit()
    session.refresh(kept_row)
    return serialize_question(kept_row)


__all__ = [
    "commit_deleted_questions",
    "commit_new_question",
    "commit_new_questions",
    "commit_recorded_choice_attempt",
    "commit_updated_question",
    "replace_question_with_duplicate",
]
