"""Facade for PDF candidate matching and detected-chapter grouping helpers."""

from __future__ import annotations

from .quiz_generation_pdf_candidate_matching import (
    extract_pdf_candidate_markers as extract_pdf_candidate_markers,
    match_descendant_chapter_from_candidate_markers as match_descendant_chapter_from_candidate_markers,
    select_pdf_question_candidate as select_pdf_question_candidate,
)
from .quiz_generation_pdf_chapter_grouping import (
    group_pdf_questions_by_detected_chapters as group_pdf_questions_by_detected_chapters,
)

__all__ = [
    "extract_pdf_candidate_markers",
    "group_pdf_questions_by_detected_chapters",
    "match_descendant_chapter_from_candidate_markers",
    "select_pdf_question_candidate",
]
