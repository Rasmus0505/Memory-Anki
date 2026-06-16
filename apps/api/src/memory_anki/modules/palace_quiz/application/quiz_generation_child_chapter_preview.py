"""Child-chapter grouped preview reconstruction helpers."""

from __future__ import annotations

from .service import PalaceQuizValidationError


def build_group_questions_by_child_chapter_preview(
    *,
    drafts: list[dict[str, object]],
    child_contexts: list[dict[str, object]],
    grouping_payload: dict[str, object],
) -> dict[str, object]:
    grouped_items: list[dict[str, object]] = []
    assigned_indexes: set[int] = set()
    context_by_id = {int(item["mini_palace_id"]): item for item in child_contexts}
    for item in grouping_payload.get("mini_palace_groups", []):
        if not isinstance(item, dict):
            continue
        try:
            child_chapter_id = int(item.get("mini_palace_id"))
        except (TypeError, ValueError):
            continue
        question_indexes = item.get("question_indexes")
        if not isinstance(question_indexes, list):
            continue
        if child_chapter_id not in context_by_id:
            raise PalaceQuizValidationError("章节分类节点必须是当前章节的直接子章节。")
        group_questions: list[dict[str, object]] = []
        for raw_index in question_indexes:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if 0 <= index < len(drafts) and index not in assigned_indexes:
                assigned_indexes.add(index)
                group_questions.append(
                    {
                        **drafts[index],
                        "classified_chapter_id": child_chapter_id,
                        "mini_palace_id": None,
                    }
                )
        if group_questions:
            grouped_items.append(
                {
                    "classified_chapter_id": child_chapter_id,
                    "classified_chapter_name": context_by_id[child_chapter_id]["name"],
                    "questions": group_questions,
                }
            )
    unassigned_questions: list[dict[str, object]] = []
    for index, question in enumerate(drafts):
        if index in assigned_indexes:
            continue
        unassigned_questions.append({**question, "classified_chapter_id": None})
    return {
        "child_chapter_groups": grouped_items,
        "unassigned_questions": unassigned_questions,
    }


__all__ = ["build_group_questions_by_child_chapter_preview"]
