"""Group PDF-generated drafts into detected descendant chapters."""

from __future__ import annotations

from typing import Any

from memory_anki.infrastructure.db.models import Chapter

from .quiz_generation_chapter_scope import resolve_pdf_grouping_scope_contexts
from .quiz_generation_pdf_candidate_matching import (
    match_descendant_chapter_from_candidate_markers,
    select_pdf_question_candidate,
)
from .service import PalaceQuizValidationError


def group_pdf_questions_by_detected_chapters(
    *,
    drafts: list[dict[str, Any]],
    question_candidates: list[dict[str, Any]],
    selected_chapter: Chapter,
) -> tuple[dict[str, Any], list[int]]:
    descendant_contexts = resolve_pdf_grouping_scope_contexts(selected_chapter)
    if len(descendant_contexts) == 0:
        raise PalaceQuizValidationError("当前范围没有可匹配的下级章节，暂时无法按识别章节分类。")

    grouped_by_chapter: dict[int, dict[str, Any]] = {}
    unassigned_questions: list[dict[str, Any]] = []
    unmatched_candidate_indexes: list[int] = []
    used_candidate_indexes: set[int] = set()

    for draft in drafts:
        candidate_index, question_candidate = select_pdf_question_candidate(
            draft,
            question_candidates,
            used_indexes=used_candidate_indexes,
        )
        if candidate_index is None or question_candidate is None:
            unassigned_questions.append({**draft, "classified_chapter_id": None})
            continue
        used_candidate_indexes.add(candidate_index)
        matched_context = match_descendant_chapter_from_candidate_markers(
            question_candidate,
            descendant_contexts,
        )
        if matched_context is None:
            unmatched_candidate_indexes.append(candidate_index)
            unassigned_questions.append({**draft, "classified_chapter_id": None})
            continue
        chapter_id = int(matched_context["chapter_id"])
        group = grouped_by_chapter.setdefault(
            chapter_id,
            {
                "classified_chapter_id": chapter_id,
                "classified_chapter_name": matched_context["name"],
                "questions": [],
            },
        )
        group["questions"].append(
            {
                **draft,
                "classified_chapter_id": chapter_id,
                "mini_palace_id": None,
            }
        )
    return (
        {
            "child_chapter_groups": list(grouped_by_chapter.values()),
            "unassigned_questions": unassigned_questions,
        },
        unmatched_candidate_indexes,
    )


__all__ = ["group_pdf_questions_by_detected_chapters"]
