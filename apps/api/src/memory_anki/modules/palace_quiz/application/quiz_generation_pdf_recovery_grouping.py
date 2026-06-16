"""Grouping and skip-summary runtime for PDF recovery save flows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .quiz_generation_chaptering import group_pdf_questions_by_detected_chapters
from .quiz_generation_pdf_candidate_skip_analysis import analyze_pdf_candidate_skips
from .quiz_generation_pdf_candidate_summaries import build_pdf_candidate_skip_summary
from .quiz_generation_shared import extract_pdf_candidate_lists


@dataclass(frozen=True, slots=True)
class PdfRecoveryGroupingResult:
    grouped_questions: dict[str, Any] | None
    skipped_reasons: list[dict[str, Any]]


def build_pdf_recovery_grouping_result(
    *,
    vision_draft_text: str,
    drafts: list[dict[str, Any]],
    classify_by_mini_palace: bool,
    selected_chapter: Any,
) -> PdfRecoveryGroupingResult:
    question_candidates, answer_candidates = extract_pdf_candidate_lists(vision_draft_text)
    grouped_questions = None
    unmatched_chapter_candidate_indexes: list[int] = []
    if classify_by_mini_palace:
        grouped_questions, unmatched_chapter_candidate_indexes = group_pdf_questions_by_detected_chapters(
            drafts=drafts,
            question_candidates=question_candidates,
            selected_chapter=selected_chapter,
        )
    skip_analysis = analyze_pdf_candidate_skips(
        question_candidates,
        answer_candidates,
        drafts=drafts,
        unmatched_chapter_candidate_indexes=unmatched_chapter_candidate_indexes,
    )
    return PdfRecoveryGroupingResult(
        grouped_questions=grouped_questions,
        skipped_reasons=build_pdf_candidate_skip_summary(skip_analysis),
    )


__all__ = [
    "build_pdf_recovery_grouping_result",
    "PdfRecoveryGroupingResult",
]
