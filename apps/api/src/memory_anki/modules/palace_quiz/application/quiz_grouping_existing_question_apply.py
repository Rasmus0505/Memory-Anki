"""Apply existing-question grouping previews into classified question copies."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .question_classification_commands import upsert_classified_question_copy


def apply_grouped_question_copies(
    session: Session,
    *,
    source_questions: list[Any],
    grouped_preview: dict[str, Any],
) -> tuple[int, list[dict[str, Any]]]:
    source_by_origin = {question.id: question for question in source_questions}
    created_or_updated = 0
    mini_palace_hit_counts: list[dict[str, Any]] = []
    for group in grouped_preview["mini_palace_groups"]:
        mini_palace_id = int(group["mini_palace_id"])
        question_items = group.get("questions") or []
        hit_count = 0
        for item in question_items:
            origin_question_id = item.get("origin_question_id") or item.get("id")
            try:
                origin_question_id_int = int(origin_question_id)
            except (TypeError, ValueError):
                continue
            source_question = source_by_origin.get(origin_question_id_int)
            if source_question is None:
                continue
            upsert_classified_question_copy(
                session,
                source_question=source_question,
                mini_palace_id=mini_palace_id,
            )
            hit_count += 1
            created_or_updated += 1
        mini_palace_hit_counts.append(
            {
                "mini_palace_id": mini_palace_id,
                "mini_palace_name": group.get("mini_palace_name") or f"专项训练 {mini_palace_id}",
                "question_count": hit_count,
            }
        )
    return created_or_updated, mini_palace_hit_counts


__all__ = ["apply_grouped_question_copies"]
