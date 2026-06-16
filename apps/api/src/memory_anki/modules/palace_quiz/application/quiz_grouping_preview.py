"""Grouped preview reconstruction for mini-palace quiz classification."""

from __future__ import annotations

from typing import Any


def build_grouped_preview_from_indexes(
    *,
    questions: list[dict[str, Any]],
    grouping_payload: dict[str, Any],
    mini_palace_contexts: list[dict[str, Any]],
) -> dict[str, Any]:
    question_count = len(questions)
    context_by_id = {
        int(item["mini_palace_id"]): item
        for item in mini_palace_contexts
        if item.get("mini_palace_id") is not None
    }
    grouped_questions: list[dict[str, Any]] = []
    assigned_indexes: set[int] = set()
    for item in grouping_payload.get("mini_palace_groups", []):
        if not isinstance(item, dict):
            continue
        mini_palace_id = item.get("mini_palace_id")
        question_indexes_raw = item.get("question_indexes")
        try:
            mini_palace_id_int = int(mini_palace_id)
        except (TypeError, ValueError):
            continue
        if mini_palace_id_int not in context_by_id or not isinstance(question_indexes_raw, list):
            continue
        question_indexes: list[int] = []
        for raw_index in question_indexes_raw:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if 0 <= index < question_count and index not in question_indexes:
                question_indexes.append(index)
                assigned_indexes.add(index)
        if not question_indexes:
            continue
        grouped_questions.append(
            {
                "mini_palace_id": mini_palace_id_int,
                "mini_palace_name": context_by_id[mini_palace_id_int]["name"],
                "questions": [
                    {
                        **questions[index],
                        "mini_palace_id": mini_palace_id_int,
                    }
                    for index in question_indexes
                ],
            }
        )

    unassigned_indexes_raw = grouping_payload.get("unassigned_question_indexes", [])
    unassigned_indexes: list[int] = []
    for raw_index in unassigned_indexes_raw:
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if 0 <= index < question_count and index not in unassigned_indexes:
            unassigned_indexes.append(index)
    if not unassigned_indexes:
        unassigned_indexes = [index for index in range(question_count) if index not in assigned_indexes]

    return {
        "mini_palace_groups": grouped_questions,
        "unassigned_questions": [questions[index] for index in unassigned_indexes],
    }


__all__ = ["build_grouped_preview_from_indexes"]
