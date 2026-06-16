"""Grouping strategy resolution for PDF preview flows."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.settings.application.ai_model_registry import AiRuntimeOptions

from .quiz_generation_chaptering import (
    flatten_child_chapter_contexts,
    group_pdf_questions_by_detected_chapters,
)
from .quiz_generation_preview_grouping import group_questions_for_preview_scope
from .quiz_generation_shared import extract_pdf_candidate_lists


def build_pdf_preview_grouped_questions(
    session: Session,
    *,
    palace: Any,
    drafts: list[dict[str, Any]],
    selected_chapter: Any = None,
    vision_draft_text: str | None = None,
    ai_options: AiRuntimeOptions | None,
) -> dict[str, Any]:
    if selected_chapter is not None and vision_draft_text:
        question_candidates, _answer_candidates = extract_pdf_candidate_lists(vision_draft_text)
        grouped_questions, _unmatched_indexes = group_pdf_questions_by_detected_chapters(
            drafts=drafts,
            question_candidates=question_candidates,
            selected_chapter=selected_chapter,
        )
        return grouped_questions
    return group_questions_for_preview_scope(
        session,
        palace=palace,
        drafts=drafts,
        selected_chapter=selected_chapter,
        child_contexts=(
            flatten_child_chapter_contexts(selected_chapter)
            if selected_chapter is not None
            else None
        ),
        feature="宫殿做题",
        child_chapter_operation="palace_quiz_group_by_child_chapter",
        mini_palace_operation="ai_prompt_palace_quiz_group_by_mini_palace",
        ai_options=ai_options,
    )


__all__ = ["build_pdf_preview_grouped_questions"]
