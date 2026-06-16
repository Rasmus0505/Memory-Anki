"""Summary projections for PDF candidate analysis and grouped recovery output."""

from __future__ import annotations

from typing import Any

from .quiz_generation_pdf_candidate_skip_analysis import PdfCandidateSkipAnalysis


def build_pdf_candidate_skip_summary(
    skip_analysis: PdfCandidateSkipAnalysis,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if skip_analysis.missing_answer_indexes:
        result.append(
            {
                "code": "missing_answer_candidate",
                "count": len(skip_analysis.missing_answer_indexes),
                "question_indexes": skip_analysis.missing_answer_indexes,
            }
        )
    if skip_analysis.unsupported_indexes:
        result.append(
            {
                "code": "unsupported_final_question_type",
                "count": len(skip_analysis.unsupported_indexes),
                "question_indexes": skip_analysis.unsupported_indexes,
            }
        )
    if skip_analysis.insufficient_indexes:
        result.append(
            {
                "code": "insufficient_candidate_data",
                "count": len(skip_analysis.insufficient_indexes),
                "question_indexes": skip_analysis.insufficient_indexes,
            }
        )
    if skip_analysis.unmatched_chapter_candidate_indexes:
        result.append(
            {
                "code": "unmatched_chapter_marker",
                "count": len(skip_analysis.unmatched_chapter_candidate_indexes),
                "question_indexes": skip_analysis.unmatched_chapter_candidate_indexes,
            }
        )
    return result


def build_grouped_summary(grouped_questions: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(grouped_questions, dict):
        return []
    child_groups = grouped_questions.get("child_chapter_groups")
    if not isinstance(child_groups, list):
        return []
    summary: list[dict[str, Any]] = []
    for group in child_groups:
        if not isinstance(group, dict):
            continue
        chapter_id = group.get("classified_chapter_id")
        chapter_name = str(group.get("classified_chapter_name") or "").strip()
        questions = group.get("questions")
        if chapter_id is None or not isinstance(questions, list):
            continue
        summary.append(
            {
                "classified_chapter_id": int(chapter_id),
                "classified_chapter_name": chapter_name,
                "question_count": len(questions),
            }
        )
    return summary


__all__ = [
    "build_grouped_summary",
    "build_pdf_candidate_skip_summary",
]
