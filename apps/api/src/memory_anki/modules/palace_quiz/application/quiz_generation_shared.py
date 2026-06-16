"""Facade for palace quiz generation shared helpers."""

from __future__ import annotations

from .quiz_generation_messages import (
    build_generation_messages as build_generation_messages,
    build_pdf_source_context as build_pdf_source_context,
    normalize_pdf_sources_input as normalize_pdf_sources_input,
)
from .quiz_generation_pdf_ai_steps import (
    ScenarioAiOptionsMap as ScenarioAiOptionsMap,
    build_pdf_pairing_prompt as build_pdf_pairing_prompt,
    build_pdf_review_prompt as build_pdf_review_prompt,
    pair_pdf_generation_with_turbo as pair_pdf_generation_with_turbo,
    recover_pdf_pairing_from_log as recover_pdf_pairing_from_log,
    resolve_pdf_step_ai_options as resolve_pdf_step_ai_options,
    review_pdf_generation_with_turbo as review_pdf_generation_with_turbo,
    should_pair_pdf_generation_with_turbo as should_pair_pdf_generation_with_turbo,
    should_review_pdf_generation_with_turbo as should_review_pdf_generation_with_turbo,
)
from .quiz_generation_pdf_candidates import (
    build_grouped_summary as build_grouped_summary,
    build_pdf_candidate_skip_summary as build_pdf_candidate_skip_summary,
    candidate_supports_known_final_type as candidate_supports_known_final_type,
    extract_chapter_markers_from_text as extract_chapter_markers_from_text,
    extract_pdf_candidate_lists as extract_pdf_candidate_lists,
    normalize_pdf_marker_text as normalize_pdf_marker_text,
)

__all__ = [
    "ScenarioAiOptionsMap",
    "build_generation_messages",
    "build_grouped_summary",
    "build_pdf_candidate_skip_summary",
    "build_pdf_pairing_prompt",
    "build_pdf_review_prompt",
    "build_pdf_source_context",
    "candidate_supports_known_final_type",
    "extract_chapter_markers_from_text",
    "extract_pdf_candidate_lists",
    "normalize_pdf_marker_text",
    "normalize_pdf_sources_input",
    "pair_pdf_generation_with_turbo",
    "recover_pdf_pairing_from_log",
    "resolve_pdf_step_ai_options",
    "review_pdf_generation_with_turbo",
    "should_pair_pdf_generation_with_turbo",
    "should_review_pdf_generation_with_turbo",
]
