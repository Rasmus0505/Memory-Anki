"""Projection helpers for PDF recovery save flows."""

from __future__ import annotations

from typing import Any

from .question_contracts import PalaceQuizValidationError
from .quiz_generation_shared import build_grouped_summary


def build_recovered_questions_to_save(
    *,
    drafts: list[dict[str, Any]],
    grouped_questions: dict[str, Any] | None,
    source_chapter_id: int,
) -> list[dict[str, Any]]:
    if grouped_questions and grouped_questions.get("child_chapter_groups"):
        questions_to_save = [
            {
                **question,
                "source_chapter_id": source_chapter_id,
                "classified_chapter_id": group["classified_chapter_id"],
                "mini_palace_id": None,
            }
            for group in grouped_questions["child_chapter_groups"]
            for question in group.get("questions", [])
        ]
        questions_to_save.extend(
            {
                **question,
                "source_chapter_id": source_chapter_id,
                "classified_chapter_id": None,
                "mini_palace_id": None,
            }
            for question in grouped_questions.get("unassigned_questions", [])
        )
    else:
        questions_to_save = [
            {
                **question,
                "source_chapter_id": source_chapter_id,
                "classified_chapter_id": None,
                "mini_palace_id": None,
            }
            for question in drafts
        ]
    if not questions_to_save:
        raise PalaceQuizValidationError("AI 日志里没有可写入题库的题目。")
    return questions_to_save


def build_pdf_recovery_save_result(
    *,
    items: list[dict[str, Any]],
    ai_call_log_id: str,
    questions_to_save: list[dict[str, Any]],
    grouped_questions: dict[str, Any] | None,
    generation_stats: dict[str, Any],
    warnings: list[str],
    skipped_reasons: list[dict[str, Any]],
) -> dict[str, Any]:
    saved_count = len(items)
    recovered_count = len(questions_to_save)
    return {
        "items": items,
        "ai_call_log_id": ai_call_log_id,
        "recovered_count": recovered_count,
        "saved_count": saved_count,
        "deduped_count": recovered_count - saved_count,
        "grouped_summary": build_grouped_summary(grouped_questions),
        "generation_stats": generation_stats,
        "warnings": warnings,
        "skipped_reasons": skipped_reasons,
    }


__all__ = [
    "build_pdf_recovery_save_result",
    "build_recovered_questions_to_save",
]
