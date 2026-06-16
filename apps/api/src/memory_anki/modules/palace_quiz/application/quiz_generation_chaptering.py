"""Facade for chapter-scope grouping and selection helpers for quiz generation."""

from __future__ import annotations

from .quiz_generation_chapter_grouping import (
    build_group_questions_by_child_chapter_preview as build_group_questions_by_child_chapter_preview,
    flatten_child_chapter_contexts as flatten_child_chapter_contexts,
    group_questions_by_child_chapters as group_questions_by_child_chapters,
    reuse_grouped_child_chapter_questions_from_log as reuse_grouped_child_chapter_questions_from_log,
)
from .quiz_generation_chapter_scope import (
    apply_source_chapter_to_drafts as apply_source_chapter_to_drafts,
    chapter_belongs_to_explicit_scope as chapter_belongs_to_explicit_scope,
    chapter_contains_explicit_scope as chapter_contains_explicit_scope,
    flatten_descendant_chapter_contexts as flatten_descendant_chapter_contexts,
    resolve_pdf_grouping_scope_contexts as resolve_pdf_grouping_scope_contexts,
    resolve_selected_generation_chapter as resolve_selected_generation_chapter,
)
from .quiz_generation_editor_summary import (
    extract_first_multi_node_summary as extract_first_multi_node_summary,
    node_children as node_children,
    node_text as node_text,
)
from .quiz_generation_pdf_chapter_matching import (
    extract_pdf_candidate_markers as extract_pdf_candidate_markers,
    group_pdf_questions_by_detected_chapters as group_pdf_questions_by_detected_chapters,
    match_descendant_chapter_from_candidate_markers as match_descendant_chapter_from_candidate_markers,
    select_pdf_question_candidate as select_pdf_question_candidate,
)

__all__ = [
    "apply_source_chapter_to_drafts",
    "build_group_questions_by_child_chapter_preview",
    "chapter_belongs_to_explicit_scope",
    "chapter_contains_explicit_scope",
    "extract_first_multi_node_summary",
    "extract_pdf_candidate_markers",
    "flatten_child_chapter_contexts",
    "flatten_descendant_chapter_contexts",
    "group_pdf_questions_by_detected_chapters",
    "group_questions_by_child_chapters",
    "match_descendant_chapter_from_candidate_markers",
    "node_children",
    "node_text",
    "resolve_pdf_grouping_scope_contexts",
    "resolve_selected_generation_chapter",
    "reuse_grouped_child_chapter_questions_from_log",
    "select_pdf_question_candidate",
]
