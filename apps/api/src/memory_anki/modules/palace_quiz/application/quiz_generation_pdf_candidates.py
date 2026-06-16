"""Facade for recovering PDF candidate helpers."""

from __future__ import annotations

from .quiz_generation_pdf_candidate_markers import (
    extract_chapter_markers_from_text as extract_chapter_markers_from_text,
    normalize_pdf_marker_text as normalize_pdf_marker_text,
)
from .quiz_generation_pdf_candidate_parsing import (
    extract_pdf_candidate_lists as extract_pdf_candidate_lists,
)
from .quiz_generation_pdf_candidate_skip_analysis import (
    analyze_pdf_candidate_skips as analyze_pdf_candidate_skips,
    PdfCandidateSkipAnalysis as PdfCandidateSkipAnalysis,
)
from .quiz_generation_pdf_candidate_summaries import (
    build_grouped_summary as build_grouped_summary,
    build_pdf_candidate_skip_summary as build_pdf_candidate_skip_summary,
)
from .quiz_generation_pdf_candidate_support import (
    candidate_supports_known_final_type as candidate_supports_known_final_type,
)


__all__ = [
    "analyze_pdf_candidate_skips",
    "build_grouped_summary",
    "build_pdf_candidate_skip_summary",
    "candidate_supports_known_final_type",
    "extract_chapter_markers_from_text",
    "extract_pdf_candidate_lists",
    "normalize_pdf_marker_text",
    "PdfCandidateSkipAnalysis",
]
