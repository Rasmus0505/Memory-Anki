"""Shared row mutation helpers for palace quiz questions."""

from __future__ import annotations

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import PalaceQuizQuestion

from .question_schema import json_dump


def apply_normalized_question_to_row(
    row: PalaceQuizQuestion,
    normalized: dict[str, object],
) -> PalaceQuizQuestion:
    row.mini_palace_id = normalized["mini_palace_id"]
    row.source_chapter_id = normalized["source_chapter_id"]
    row.classified_chapter_id = normalized["classified_chapter_id"]
    row.origin_question_id = normalized["origin_question_id"]
    row.question_type = normalized["question_type"]
    row.stem = normalized["stem"]
    row.options_json = json_dump(normalized["options"], default=[])
    row.answer_payload_json = json_dump(normalized["answer_payload"], default={})
    row.analysis = normalized["analysis"]
    row.source_meta_json = json_dump(normalized["source_meta"], default={})
    return row


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


__all__ = [
    "apply_normalized_question_to_row",
    "copy_question_content",
    "merge_question_attempt_counters",
]
