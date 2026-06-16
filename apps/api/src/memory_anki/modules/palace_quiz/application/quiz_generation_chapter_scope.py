"""Facade for chapter-scope selection and context helpers."""

from __future__ import annotations

from .quiz_generation_chapter_scope_context import (
    flatten_descendant_chapter_contexts as flatten_descendant_chapter_contexts,
    resolve_pdf_grouping_scope_contexts as resolve_pdf_grouping_scope_contexts,
)
from .quiz_generation_chapter_scope_drafts import (
    apply_source_chapter_to_drafts as apply_source_chapter_to_drafts,
)
from .quiz_generation_chapter_scope_selection import (
    chapter_belongs_to_explicit_scope as chapter_belongs_to_explicit_scope,
    chapter_contains_explicit_scope as chapter_contains_explicit_scope,
    resolve_selected_generation_chapter as resolve_selected_generation_chapter,
)


__all__ = [
    "apply_source_chapter_to_drafts",
    "chapter_belongs_to_explicit_scope",
    "chapter_contains_explicit_scope",
    "flatten_descendant_chapter_contexts",
    "resolve_pdf_grouping_scope_contexts",
    "resolve_selected_generation_chapter",
]
